import { spawnSync } from 'node:child_process'
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
const PNPM_EXEC_PATH_VARIABLE = 'npm_execpath'
const JS_ENTRY_PATTERN = /\.[cm]?js$/u

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
		throw new Error('josh-app must be run through pnpm (e.g. `pnpm josh-app check:ci`)')
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

// A spawn that could not start at all is a programming/environment error, not a check failure,
// so it throws rather than collapsing into an exit status the caller would report as findings.
function to_exit_status(outcome: SpawnOutcome): number {
	if (outcome.error !== undefined) throw outcome.error

	return outcome.status ?? SIGNAL_FAILURE_STATUS
}

const process_runner = {
	SUCCESS_STATUS,
	resolve_pnpm_invocation,
	current_pnpm_invocation,
	to_pnpm_argv,
	run_command,
	run_pnpm,
	to_exit_status,
}

export { process_runner }
export type { CommandRunner, PnpmInvocation }
