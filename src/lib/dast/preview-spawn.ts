import { spawn, type ChildProcessByStdio } from 'node:child_process'
import type { Readable } from 'node:stream'
import { process_runner } from '#process/runner.js'
import type { PreviewHandle } from './preview-handle.js'
import { preview_teardown } from './preview-teardown.js'

// How the preview process is created and observed. Split from preview.ts so that file is only about
// deciding whether the server answering is ours; everything here is about producing the child whose
// identity that decision is made against.
//
// The server is started through the app-kit-managed `preview` script rather than a second
// hand-written wrangler command line, so the scanned server is byte-for-byte the one consumers
// (and playwright.config.ts) already run. `--ip 0.0.0.0` is appended because wrangler otherwise
// binds to loopback only, which the scanner container cannot reach through host-gateway.
const PREVIEW_SCRIPT = 'preview'
const LISTEN_ALL_INTERFACES = '0.0.0.0'
const PREVIEW_ARGV: ReadonlyArray<string> = ['run', PREVIEW_SCRIPT, '--ip', LISTEN_ALL_INTERFACES]

// What `spawn` returns for this command's stdio shape (`['ignore', 'pipe', 'pipe']`): no stdin, both
// output streams readable. Named because the capture helpers below need exactly that guarantee.
type PipedChild = ChildProcessByStdio<null, Readable, Readable>

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

function start_preview_process(cwd: string): PreviewHandle {
	const invocation = process_runner.current_pnpm_invocation()
	const child = spawn(invocation.command, process_runner.to_pnpm_argv(invocation, PREVIEW_ARGV), {
		cwd,
		stdio: ['ignore', 'pipe', 'pipe'],
		detached: true,
	})

	const output = collect_output(child)
	const has_exited = track_exit(child)

	function stop(): void {
		preview_teardown.stop_child(child)
	}

	preview_teardown.register_teardown(stop)

	return { stop, output, has_exited, group_id: () => child.pid }
}

const preview_spawn = {
	PREVIEW_ARGV,
	start_preview_process,
}

export { preview_spawn }
