import { spawn, type ChildProcess } from 'node:child_process'
import { process_runner } from '#process/runner.js'

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
}

interface PreviewDependencies {
	start: (cwd: string) => PreviewHandle
	probe: (url: string) => Promise<boolean>
	sleep: (ms: number) => Promise<void>
	now: () => number
}

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
function default_start(cwd: string): PreviewHandle {
	const invocation = process_runner.current_pnpm_invocation()
	const child = spawn(invocation.command, process_runner.to_pnpm_argv(invocation, PREVIEW_ARGV), {
		cwd,
		stdio: ['ignore', 'pipe', 'pipe'],
		detached: true,
	})
	const chunks: Array<string> = []

	function collect(chunk: unknown): void {
		chunks.push(String(chunk))
	}

	child.stdout.on('data', collect)
	child.stderr.on('data', collect)

	function stop(): void {
		stop_child(child)
	}

	function output(): string {
		return chunks.join('')
	}

	register_teardown(stop)

	return { stop, output }
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

// Returns whether the server answered before the deadline. Reporting rather than throwing lets
// the caller attach the captured server output, which is what actually explains a failed boot.
async function wait_until_ready(url: string, deps: PreviewDependencies): Promise<boolean> {
	const deadline = deps.now() + READY_TIMEOUT_MS

	while (deps.now() < deadline) {
		if (await deps.probe(url)) return true

		await deps.sleep(POLL_INTERVAL_MS)
	}

	return false
}

function build_timeout_message(url: string, output: string): string {
	const header = `Preview server did not become ready at ${url} within ${String(READY_TIMEOUT_MS)}ms`
	if (output === '') return header

	return `${header}\n--- preview server output ---\n${output}`
}

// Start the preview server and resolve only once it answers. A server that never comes up is torn
// down here rather than leaked to the caller, which never receives a handle it would have to clean
// up on a path it did not open.
async function start_preview(
	cwd: string,
	port: number,
	deps: PreviewDependencies = DEFAULT_DEPENDENCIES,
): Promise<PreviewHandle> {
	const handle = deps.start(cwd)
	const url = build_probe_url(port)

	if (await wait_until_ready(url, deps)) return handle

	handle.stop()

	throw new Error(build_timeout_message(url, handle.output()))
}

const preview_server = {
	PREVIEW_ARGV,
	TEARDOWN_SIGNALS,
	build_probe_url,
	register_teardown,
	start_preview,
}

export { preview_server }
export type { PreviewDependencies, PreviewHandle }
