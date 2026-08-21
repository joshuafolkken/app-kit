import { port_owner, type Ownership } from './port-owner.js'
import type { PreviewHandle } from './preview-handle.js'
import { preview_spawn } from './preview-spawn.js'
import { preview_teardown } from './preview-teardown.js'

// A cold `wrangler dev` boot is slow; the timeout only has to be shorter than a hung CI job.
const READY_TIMEOUT_MS = 120_000
const POLL_INTERVAL_MS = 500

// A holder can accept the connection and then never answer — a wrangler mid-restart does exactly
// that — and `fetch` waits for a response forever. Unbounded, that hangs the PRE-SPAWN check, which
// runs outside the readiness deadline and so has nothing else to end it: the pre-push hook simply
// stops. Generous against a listener's first response, and a probe that times out only means "not
// yet", so the poll loop just asks again.
const PROBE_TIMEOUT_MS = 5000

interface PreviewDependencies {
	start: (cwd: string) => PreviewHandle
	probe: (url: string) => Promise<boolean>
	sleep: (ms: number) => Promise<void>
	now: () => number
	is_port_free: (port: number) => Promise<boolean>
	check_ownership: (port: number, group_id: number) => Ownership
	warn: (message: string) => void
}

// Why readiness is not just "something answered on the port" (app-kit#136): during #122's pre-push
// run another project's wrangler preview was already listening on 4173, so the first probe succeeded
// instantly, Playwright (with PLAYWRIGHT_REUSE_SERVER=1) and the ZAP scan both talked to that FOREIGN
// app, and app-kit's own wrangler — which had failed to bind — was never heard from. The gate only
// failed because the stranger happened to 404 on the probed route.
//
// #136 answered that with a readiness condition run BEFORE the spawn: if the probe URL already
// answers, it answering later proves nothing, so the run stops. #175 is what that left open — the
// probe establishes that SOMETHING answers, never WHOSE answer it is:
//
//   - a process can hold the socket while answering no HTTP (an orphaned workerd mid-teardown), and
//     the pre-check waves it through; port_owner.is_port_free asks the kernel instead,
//   - and nothing re-examines the port once booting starts, so a process that claims loopback during
//     the boot inherits every later probe; port_owner.check_ownership compares the listener's process
//     group against the one we spawned.
//
// 'unverified' is the third answer and deliberately not an error: without `lsof` the run still has
// the guarantee the pre-spawn checks gave it, and only the mid-boot takeover goes unnoticed.
type ReadinessOutcome = 'ready' | 'unverified' | 'foreign' | 'exited' | 'timeout'

function build_probe_url(port: number): string {
	return `http://${port_owner.LOOPBACK_HOST}:${String(port)}/`
}

// Any HTTP response — including a 404 or a 500 — proves the listener is up, which is all the scan
// needs. Only a transport-level failure (nothing listening yet) counts as not-ready.
async function default_probe(url: string): Promise<boolean> {
	try {
		await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })

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

// stderr rather than a console call: this file is library code, where printing is the caller's
// business — the channel is injectable for exactly that reason, and stdout belongs to the tools
// whose output the run is actually reading.
function default_warn(message: string): void {
	process.stderr.write(`${message}\n`)
}

const DEFAULT_DEPENDENCIES: PreviewDependencies = {
	start: preview_spawn.start_preview_process,
	probe: default_probe,
	sleep: default_sleep,
	now: default_now,
	is_port_free: port_owner.is_port_free,
	check_ownership: port_owner.check_ownership,
	warn: default_warn,
}

// A handle with no pid never had a process to own the socket, so there is nothing to attribute the
// answer to — the same non-answer as a missing `lsof`, and the exit check below is what actually
// reports that case.
function classify_answer(
	port: number,
	handle: PreviewHandle,
	check: PreviewDependencies['check_ownership'],
): ReadinessOutcome {
	const group_id = handle.group_id()
	if (group_id === undefined) return 'unverified'

	const ownership = check(port, group_id)
	if (ownership === 'unknown') return 'unverified'

	return ownership === 'owned' ? 'ready' : 'foreign'
}

// Exit is checked FIRST, and the order is the whole point: our process being gone disqualifies any
// answer, because in the pre-check's residual race the answer is coming from whoever took the port.
// Accepting the probe first would hand back a dead handle and let the run check that foreign server —
// the very failure app-kit#136 exists to remove. `undefined` means "still booting, keep waiting".
function poll_outcome(
	is_ready: boolean,
	port: number,
	handle: PreviewHandle,
	deps: PreviewDependencies,
): ReadinessOutcome | undefined {
	if (handle.has_exited()) return 'exited'
	if (!is_ready) return undefined

	return classify_answer(port, handle, deps.check_ownership)
}

// Reports the outcome rather than throwing, so the caller can attach the captured server output —
// which is what actually explains a boot that failed instead of merely being slow.
async function wait_until_ready(
	url: string,
	port: number,
	handle: PreviewHandle,
	deps: PreviewDependencies,
): Promise<ReadinessOutcome> {
	const deadline = deps.now() + READY_TIMEOUT_MS

	while (deps.now() < deadline) {
		const outcome = poll_outcome(await deps.probe(url), port, handle, deps)
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

// Both checks describe the same refusal — this run will not adopt a port it does not own — but they
// see different holders, so both run: the HTTP probe catches a server that answers, and the kernel
// check catches one that holds the socket silently.
async function assert_port_available(
	url: string,
	port: number,
	deps: PreviewDependencies,
): Promise<void> {
	if (await deps.probe(url)) throw new Error(port_owner.build_occupied_message(url, port))
	if (!(await deps.is_port_free(port))) throw new Error(port_owner.build_held_message(port))
}

// A foreign answer is torn down like any other failed boot: our spawn is still running, and leaving
// it alive would keep a second server on a port this run has just declared untrustworthy.
function fail_readiness(
	outcome: ReadinessOutcome,
	url: string,
	port: number,
	handle: PreviewHandle,
): Error {
	handle.stop()

	if (outcome === 'foreign') return new Error(port_owner.build_foreign_message(url, port))

	return new Error(build_failure_message(outcome, url, handle.output()))
}

// Start the preview server and resolve only once IT answers. Three things stand between the caller
// and a false pass: nothing may already answer on the probe URL, nothing may be holding the port
// silently, and the process that eventually answers has to belong to the group we spawned. A server
// that never comes up is torn down here, so the caller never holds a handle it must clean up on a
// path it did not open.
async function start_preview(
	cwd: string,
	port: number,
	deps: PreviewDependencies = DEFAULT_DEPENDENCIES,
): Promise<PreviewHandle> {
	const url = build_probe_url(port)

	await assert_port_available(url, port, deps)

	const handle = deps.start(cwd)
	const outcome = await wait_until_ready(url, port, handle, deps)

	if (outcome === 'unverified') deps.warn(port_owner.build_unverified_message(port))
	if (outcome === 'ready' || outcome === 'unverified') return handle

	throw fail_readiness(outcome, url, port, handle)
}

const preview_server = {
	PREVIEW_ARGV: preview_spawn.PREVIEW_ARGV,
	PROBE_TIMEOUT_MS,
	default_probe,
	TEARDOWN_SIGNALS: preview_teardown.TEARDOWN_SIGNALS,
	build_occupied_message: port_owner.build_occupied_message,
	build_probe_url,
	register_teardown: preview_teardown.register_teardown,
	start_preview,
}

export { preview_server }
export type { PreviewDependencies }

export { type PreviewHandle } from './preview-handle.js'
