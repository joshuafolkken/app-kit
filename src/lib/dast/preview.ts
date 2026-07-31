import { spawn, type ChildProcess, type ChildProcessByStdio } from 'node:child_process'
import type { Readable } from 'node:stream'
import { process_runner } from '#process/runner.js'

// What `spawn` returns for this command's stdio shape (`['ignore', 'pipe', 'pipe']`): no stdin, both
// output streams readable. Named because the capture helpers below need exactly that guarantee.
type PipedChild = ChildProcessByStdio<null, Readable, Readable>

// Boot / readiness / teardown for the preview server the DAST scan probes.
//
// The server is started through the app-kit-managed `preview` script rather than a second
// hand-written wrangler command line, so the scanned server is byte-for-byte the one consumers
// (and playwright.config.ts) already run. `--ip 0.0.0.0` is appended because wrangler otherwise
// binds to loopback only, which the scanner container cannot reach through host-gateway.
const PREVIEW_SCRIPT = 'preview'
const LISTEN_ALL_INTERFACES = '0.0.0.0'
const PREVIEW_ARGV: ReadonlyArray<string> = ['run', PREVIEW_SCRIPT, '--ip', LISTEN_ALL_INTERFACES]

// Readiness is probed on loopback (the host side of the same listener) — no container involved.
const PROBE_HOST = '127.0.0.1'

// A cold `wrangler dev` boot is slow; the timeout only has to be shorter than a hung CI job.
const READY_TIMEOUT_MS = 120_000
const POLL_INTERVAL_MS = 500

const TERMINATE_SIGNAL = 'SIGTERM'

interface PreviewHandle {
	stop: () => void
	// Everything the server has written so far — shown only when it fails to become ready.
	output: () => string
	// Whether the spawned process is already gone. A wrangler that could not bind exits within
	// milliseconds; without this the readiness loop would poll a dead server for the full timeout.
	has_exited: () => boolean
}

interface PreviewDependencies {
	start: (cwd: string) => PreviewHandle
	probe: (url: string) => Promise<boolean>
	sleep: (ms: number) => Promise<void>
	now: () => number
}

// Why readiness is not just "something answered on the port" (app-kit#136): during #122's pre-push
// run another project's wrangler preview was already listening on 4173, so the first probe succeeded
// instantly, Playwright (with PLAYWRIGHT_REUSE_SERVER=1) and the ZAP scan both talked to that FOREIGN
// app, and app-kit's own wrangler — which had failed to bind — was never heard from. The gate only
// failed because the stranger happened to 404 on the probed route.
//
// The guard is the readiness condition run BEFORE the spawn: if the probe URL already answers, then
// it answering later proves nothing, so the run stops instead of adopting a server it did not start.
// Deliberately an HTTP probe and not a bind check — `wrangler dev` binds loopback by default, and a
// loopback-only listener does NOT collide with the 0.0.0.0 bind PREVIEW_ARGV asks for (measured on
// macOS: both bind happily, and 127.0.0.1 traffic then reaches the squatter). A bind check would
// therefore have missed the exact incident this fixes. A holder that answers no HTTP at all is out of
// the pre-check's reach, but it cannot fool readiness either: our wrangler then dies or never answers,
// both of which now fail loudly below.
type ReadinessOutcome = 'ready' | 'exited' | 'timeout'

function build_probe_url(port: number): string {
	return `http://${PROBE_HOST}:${String(port)}/`
}

// wrangler spawns its own workerd child, so the whole process GROUP has to be signalled — killing
// only the direct child would orphan the listener and leave port 4173 occupied. `detached: true`
// at spawn time is what makes the child a group leader that `-pid` can address.
function stop_child(child: ChildProcess): void {
	const { pid } = child
	if (pid === undefined) return

	try {
		process.kill(-pid, TERMINATE_SIGNAL)
	} catch {
		// The group already exited (e.g. the server crashed on boot) — nothing left to tear down.
	}
}

// The flip side of `detached: true`: the child sits in its OWN process group, so a Ctrl-C
// delivered to josh-app's group never reaches it. Without this wiring an interrupted scan — a
// likely event, since the scan runs for minutes — would leave wrangler orphaned on port 4173,
// breaking every later `dast` run and the e2e suite that shares the port.
const TEARDOWN_SIGNALS: ReadonlyArray<NodeJS.Signals> = ['SIGINT', 'SIGTERM', 'SIGHUP']

type SignalRegistrar = (signal: NodeJS.Signals, handler: () => void) => void
type SignalRaiser = (signal: NodeJS.Signals) => void

function default_register(signal: NodeJS.Signals, handler: () => void): void {
	process.once(signal, handler)
}

function default_raise(signal: NodeJS.Signals): void {
	process.kill(process.pid, signal)
}

// Registering a listener suppresses Node's default signal disposition, so josh-app would hang
// after tearing the server down. Re-raising the same signal — the `once` listener has already
// removed itself, so the default action applies — restores it, and the shell sees a genuine
// signal death rather than a synthesized exit status.
function make_signal_handler(
	signal: NodeJS.Signals,
	stop: () => void,
	raise: SignalRaiser,
): () => void {
	function handle(): void {
		stop()
		raise(signal)
	}

	return handle
}

function register_teardown(
	stop: () => void,
	register: SignalRegistrar = default_register,
	raise: SignalRaiser = default_raise,
): void {
	for (const signal of TEARDOWN_SIGNALS) {
		register(signal, make_signal_handler(signal, stop, raise))
	}
}

// Captured rather than inherited. Two reasons: the server's routine shutdown emits
// `[ELIFECYCLE] Command failed with exit code 143` (128 + SIGTERM) when the scan tears it down,
// which lands AFTER the ZAP summary and reads as a failed run even on a clean pass; and wrangler's
// request log otherwise interleaves with the scan output. The buffer is surfaced only when the
// server fails to boot, which is the one time it is diagnostic.
function collect_output(child: PipedChild): () => string {
	const chunks: Array<string> = []

	function collect(chunk: unknown): void {
		chunks.push(String(chunk))
	}

	child.stdout.on('data', collect)
	child.stderr.on('data', collect)

	return function output(): string {
		return chunks.join('')
	}
}

// A wrangler that cannot bind is gone in milliseconds, long before any readiness deadline — so the
// exit has to be observable, not inferred from a timeout that a squatter's answers would prevent.
function track_exit(child: PipedChild): () => boolean {
	const state = { did_exit: false }

	child.once('close', () => {
		state.did_exit = true
	})

	return function has_exited(): boolean {
		return state.did_exit
	}
}

function default_start(cwd: string): PreviewHandle {
	const invocation = process_runner.current_pnpm_invocation()
	const child = spawn(invocation.command, process_runner.to_pnpm_argv(invocation, PREVIEW_ARGV), {
		cwd,
		stdio: ['ignore', 'pipe', 'pipe'],
		detached: true,
	})

	const output = collect_output(child)
	const has_exited = track_exit(child)

	function stop(): void {
		stop_child(child)
	}

	register_teardown(stop)

	return { stop, output, has_exited }
}

// Any HTTP response — including a 404 or a 500 — proves the listener is up, which is all the scan
// needs. Only a transport-level failure (nothing listening yet) counts as not-ready.
async function default_probe(url: string): Promise<boolean> {
	try {
		await fetch(url, { redirect: 'manual' })

		return true
	} catch {
		return false
	}
}

async function default_sleep(ms: number): Promise<void> {
	await new Promise<void>((resolve) => {
		setTimeout(resolve, ms)
	})
}

function default_now(): number {
	return Date.now()
}

const DEFAULT_DEPENDENCIES: PreviewDependencies = {
	start: default_start,
	probe: default_probe,
	sleep: default_sleep,
	now: default_now,
}

// Exit is checked FIRST, and the order is the whole point: our process being gone disqualifies any
// answer, because in the pre-check's residual race the answer is coming from whoever took the port.
// Accepting the probe first would hand back a dead handle and let the run check that foreign server —
// the very failure app-kit#136 exists to remove. `undefined` means "still booting, keep waiting".
function poll_outcome(is_ready: boolean, handle: PreviewHandle): ReadinessOutcome | undefined {
	if (handle.has_exited()) return 'exited'
	if (is_ready) return 'ready'

	return undefined
}

// Reports the outcome rather than throwing, so the caller can attach the captured server output —
// which is what actually explains a boot that failed instead of merely being slow.
async function wait_until_ready(
	url: string,
	handle: PreviewHandle,
	deps: PreviewDependencies,
): Promise<ReadinessOutcome> {
	const deadline = deps.now() + READY_TIMEOUT_MS

	while (deps.now() < deadline) {
		const outcome = poll_outcome(await deps.probe(url), handle)
		if (outcome !== undefined) return outcome

		await deps.sleep(POLL_INTERVAL_MS)
	}

	return 'timeout'
}

function with_output(header: string, output: string): string {
	if (output === '') return header

	return `${header}\n--- preview server output ---\n${output}`
}

function build_failure_message(outcome: ReadinessOutcome, url: string, output: string): string {
	const header =
		outcome === 'exited'
			? `Preview server exited before answering at ${url}`
			: `Preview server did not become ready at ${url} within ${String(READY_TIMEOUT_MS)}ms`

	return with_output(header, output)
}

// Names the port and how to find its owner: the whole failure is "something else is on 4173", and a
// message that does not say which process to look for just moves the guessing to the reader. The
// cleanup names the PID that lookup returns rather than a process-name kill: the likely owner is
// ANOTHER project's preview (that is the incident behind #136), so `pkill -f 'wrangler dev'` would
// take out the very server someone else is working against.
function build_occupied_message(url: string, port: number): string {
	const number = String(port)

	return [
		`Preview port ${number} already answers at ${url}, so it is held by a server josh-app did not start.`,
		`Reusing it would check that application instead of this one, so the run stops here.`,
		`Find the owner with: lsof -nP -iTCP:${number} -sTCP:LISTEN`,
		`Then stop that PID (kill <pid>) — it may be another project's preview, or an orphan from an interrupted run.`,
	].join('\n')
}

// Start the preview server and resolve only once IT answers. Two things stand between the caller and
// a false pass: nothing may already be answering on the probe URL (otherwise a stranger's server
// would satisfy every readiness probe), and a spawn that dies is reported with its captured output
// rather than polled until the deadline. A server that never comes up is torn down here, so the
// caller never holds a handle it must clean up on a path it did not open.
async function start_preview(
	cwd: string,
	port: number,
	deps: PreviewDependencies = DEFAULT_DEPENDENCIES,
): Promise<PreviewHandle> {
	const url = build_probe_url(port)

	if (await deps.probe(url)) throw new Error(build_occupied_message(url, port))

	const handle = deps.start(cwd)
	const outcome = await wait_until_ready(url, handle, deps)

	if (outcome === 'ready') return handle

	handle.stop()

	throw new Error(build_failure_message(outcome, url, handle.output()))
}

const preview_server = {
	PREVIEW_ARGV,
	TEARDOWN_SIGNALS,
	build_occupied_message,
	build_probe_url,
	register_teardown,
	start_preview,
}

export { preview_server }
export type { PreviewDependencies, PreviewHandle }
