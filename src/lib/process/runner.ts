import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'
import type { SpawnOutcome } from '#cloudflare/orchestrate.js'

// Shared subprocess plumbing for every josh-app command that shells out (`check`, `dast`).
// Single-sourced here rather than re-derived per command: the pnpm-entry resolution below is
// subtle enough that a second copy would drift.
//
// pnpm sets `npm_execpath` to its own CLI entry for every script/bin it runs. Spawning that
// absolute path (via node when it is a JS entry, directly when it is a standalone executable)
// avoids any PATH lookup — the same policy as orchestrate.ts — and guarantees the very pnpm
// that invoked josh-app runs the spawned steps. npm/yarn/bun also set the variable but parse
// `exec`/`run` arguments differently, so anything that is not pnpm is rejected up front.
//
// The variable is a fast path, NOT a precondition: only `pnpm run <script>` sets it. `pnpm
// josh-app verify` in a consumer repo has no matching script, so pnpm falls through to `pnpm
// exec` semantics and launches the `josh-app` bin WITHOUT `npm_execpath` — which made the
// pre-push hook abort on any plain `git push` (app-kit#122; it only appeared to work when the
// ambient shell was already inside a pnpm lifecycle script and leaked the variable into the
// hook). So a missing value falls back to resolving `pnpm` on PATH, the same way run_command
// resolves `docker`. Corepack/`packageManager` still decide which pnpm version that is.
const PNPM_EXEC_PATH_VARIABLE = 'npm_execpath'
const PNPM_PATH_COMMAND = 'pnpm'
const JS_ENTRY_PATTERN = /\.[cm]?js$/u

// The one production build every runtime command runs before it boots a preview — `dast`, `load`,
// `verify` and `shot` each need the app compiled first, and each carried its own copy of this argv
// until it was single-sourced here (app-kit#200).
const BUILD_ARGV: ReadonlyArray<string> = ['run', 'build']

const SUCCESS_STATUS = 0
// A spawn that dies without a status (e.g. killed by a signal) still has to fail the command.
const SIGNAL_FAILURE_STATUS = 1

interface PnpmInvocation {
	command: string
	prefix_args: ReadonlyArray<string>
}

// The shape every injectable runner shares: argv plus the project directory to run it in.
type CommandRunner = (argv: ReadonlyArray<string>, cwd: string) => SpawnOutcome

function resolve_pnpm_invocation(exec_path: string | undefined): PnpmInvocation {
	if (exec_path === undefined || exec_path === '') {
		return { command: PNPM_PATH_COMMAND, prefix_args: [] }
	}

	const entry_name = path.basename(exec_path)

	if (!entry_name.includes('pnpm')) {
		throw new Error(`josh-app requires pnpm, but it was invoked through ${entry_name}`)
	}

	if (JS_ENTRY_PATTERN.test(entry_name)) {
		return { command: process.execPath, prefix_args: [exec_path] }
	}

	return { command: exec_path, prefix_args: [] }
}

function current_pnpm_invocation(): PnpmInvocation {
	return resolve_pnpm_invocation(process.env[PNPM_EXEC_PATH_VARIABLE])
}

function to_pnpm_argv(invocation: PnpmInvocation, argv: ReadonlyArray<string>): Array<string> {
	return [...invocation.prefix_args, ...argv]
}

// Run a bare executable (e.g. `docker`) through PATH. Unlike pnpm there is no execpath hint to
// resolve, so the caller's environment decides which binary runs.
function run_command(bin: string, argv: ReadonlyArray<string>, cwd: string): SpawnOutcome {
	const result = spawnSync(bin, [...argv], { cwd, stdio: 'inherit' })

	return { status: result.status, error: result.error }
}

function run_pnpm(argv: ReadonlyArray<string>, cwd: string): SpawnOutcome {
	const invocation = current_pnpm_invocation()

	return run_command(invocation.command, to_pnpm_argv(invocation, argv), cwd)
}

// Async sibling of run_command: spawns the process without blocking the event loop and resolves
// when it exits. The `verify` fan-out uses this for the long ZAP container run so it executes
// concurrently with the (synchronous) E2E step against the one shared server. stdio is inherited
// — the child writes straight to the terminal, so there is no Node-side pipe to fill and stall
// while the event loop is blocked in the concurrent spawnSync (which would risk a deadlock).
async function run_command_async(
	bin: string,
	argv: ReadonlyArray<string>,
	cwd: string,
): Promise<SpawnOutcome> {
	return await new Promise<SpawnOutcome>((resolve) => {
		const child = spawn(bin, [...argv], { cwd, stdio: 'inherit' })

		child.on('error', (error) => {
			// eslint-disable-next-line unicorn/no-null -- SpawnOutcome.status is number | null
			resolve({ status: null, error })
		})
		child.on('close', (code) => {
			resolve({ status: code, error: undefined })
		})
	})
}

// Like run_pnpm, but layers extra environment variables over the inherited env — the `verify`
// orchestrator uses this to hand Playwright PLAYWRIGHT_REUSE_SERVER=1 (and the CI flags) so it
// reuses the already-booted preview instead of building and starting its own.
function run_pnpm_with_environment(
	argv: ReadonlyArray<string>,
	cwd: string,
	environment: Readonly<Record<string, string>>,
): SpawnOutcome {
	const invocation = current_pnpm_invocation()
	const result = spawnSync(invocation.command, to_pnpm_argv(invocation, argv), {
		cwd,
		stdio: 'inherit',
		env: { ...process.env, ...environment },
	})

	return { status: result.status, error: result.error }
}

// A spawn that could not start at all is a programming/environment error, not a check failure,
// so it throws rather than collapsing into an exit status the caller would report as findings.
function to_exit_status(outcome: SpawnOutcome): number {
	if (outcome.error !== undefined) throw outcome.error

	return outcome.status ?? SIGNAL_FAILURE_STATUS
}

// The build step as `verify` and `shot` run it: the default runner, straight to an exit status.
// `dast` and `load` inject their own pnpm runner instead, so they pass BUILD_ARGV to that.
function run_build(cwd: string): number {
	return to_exit_status(run_pnpm(BUILD_ARGV, cwd))
}

const process_runner = {
	BUILD_ARGV,
	SUCCESS_STATUS,
	resolve_pnpm_invocation,
	current_pnpm_invocation,
	to_pnpm_argv,
	run_command,
	run_command_async,
	run_pnpm,
	run_pnpm_with_environment,
	run_build,
	to_exit_status,
}

export { process_runner }
export type { CommandRunner, PnpmInvocation }
