import type { ChildProcess } from 'node:child_process'

// Killing the preview server, and making sure an interrupt still reaches it. Split out of preview.ts
// because it is process-group plumbing rather than readiness logic — and because both halves exist
// only as consequences of the same `detached: true` at spawn time.
const TERMINATE_SIGNAL = 'SIGTERM'

// wrangler spawns its own workerd child, so the whole process GROUP has to be signalled — killing
// only the direct child would orphan the listener and leave the preview port occupied. `detached:
// true` at spawn time is what makes the child a group leader that `-pid` can address.
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
// likely event, since the scan runs for minutes — would leave wrangler orphaned on the preview
// port, breaking every later `dast` run and the e2e suite that shares it.
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

const preview_teardown = {
	TEARDOWN_SIGNALS,
	register_teardown,
	stop_child,
}

export { preview_teardown }
export type { SignalRaiser, SignalRegistrar }
