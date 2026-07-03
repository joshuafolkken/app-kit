import { spawnSync } from 'node:child_process'
import path from 'node:path'
import type { SpawnOutcome } from '#cloudflare/orchestrate.js'

// SvelteKit type-check commands app-kit hosts as `josh-app check` / `check:ci` (the receiver for
// kit#628's framework-agnostic removal of kit's `check:svelte*`). Every step runs through the
// consumer's own pnpm bin resolution: `svelte-check` / `@sveltejs/kit` are standard SvelteKit
// devDependencies, and FAST_CHECK_PACKAGE is seeded by the sync overlay (see sync.ts, which
// imports the constant so the seeded dependency and the spawned bin can never drift apart).
const FAST_CHECK_PACKAGE = 'svelte-fast-check'

const SYNC_ARGS: ReadonlyArray<string> = ['exec', 'svelte-kit', 'sync']
const FAST_CHECK_ARGS: ReadonlyArray<string> = ['exec', FAST_CHECK_PACKAGE, '--incremental']
const CI_CHECK_ARGS: ReadonlyArray<string> = [
	'exec',
	'svelte-check',
	'--tsconfig',
	'./tsconfig.json',
]

const SUCCESS_STATUS = 0
// A spawn that dies without a status (e.g. killed by a signal) still has to fail the check.
const SIGNAL_FAILURE_STATUS = 1

type PnpmRunner = (argv: ReadonlyArray<string>, cwd: string) => SpawnOutcome

interface PnpmInvocation {
	command: string
	prefix_args: ReadonlyArray<string>
}

// pnpm sets `npm_execpath` to its own CLI entry for every script/bin it runs. Spawning that
// absolute path (via node when it is a JS entry, directly when it is a standalone executable)
// avoids any PATH lookup — the same policy as orchestrate.ts — and guarantees the very pnpm
// that invoked josh-app runs the check steps. npm/yarn/bun also set the variable but parse
// `exec` arguments differently, so anything that is not pnpm is rejected up front.
const PNPM_EXEC_PATH_VARIABLE = 'npm_execpath'
const JS_ENTRY_PATTERN = /\.[cm]?js$/u

function resolve_pnpm_invocation(exec_path: string | undefined): PnpmInvocation {
	if (exec_path === undefined || exec_path === '') {
		throw new Error('josh-app check must be run through pnpm (e.g. `pnpm josh-app check:ci`)')
	}

	const entry_name = path.basename(exec_path)

	if (!entry_name.includes('pnpm')) {
		throw new Error(`josh-app check requires pnpm, but it was invoked through ${entry_name}`)
	}

	if (JS_ENTRY_PATTERN.test(entry_name)) {
		return { command: process.execPath, prefix_args: [exec_path] }
	}

	return { command: exec_path, prefix_args: [] }
}

function default_pnpm(argv: ReadonlyArray<string>, cwd: string): SpawnOutcome {
	const invocation = resolve_pnpm_invocation(process.env[PNPM_EXEC_PATH_VARIABLE])
	const result = spawnSync(invocation.command, [...invocation.prefix_args, ...argv], {
		cwd,
		stdio: 'inherit',
	})

	return { status: result.status, error: result.error }
}

function to_exit_status(outcome: SpawnOutcome): number {
	if (outcome.error !== undefined) throw outcome.error

	return outcome.status ?? SIGNAL_FAILURE_STATUS
}

// `svelte-kit sync` always runs first so a clean checkout has generated types; the checker only
// runs when sync succeeded, and the first non-zero status becomes the command's exit status.
function run_steps(
	steps: ReadonlyArray<ReadonlyArray<string>>,
	cwd: string,
	spawn: PnpmRunner,
): number {
	for (const argv of steps) {
		const status = to_exit_status(spawn(argv, cwd))
		if (status !== SUCCESS_STATUS) return status
	}

	return SUCCESS_STATUS
}

function run_check(cwd: string, spawn: PnpmRunner = default_pnpm): number {
	return run_steps([SYNC_ARGS, FAST_CHECK_ARGS], cwd, spawn)
}

function run_check_ci(cwd: string, spawn: PnpmRunner = default_pnpm): number {
	return run_steps([SYNC_ARGS, CI_CHECK_ARGS], cwd, spawn)
}

const app_check = { FAST_CHECK_PACKAGE, resolve_pnpm_invocation, run_check, run_check_ci }

export { app_check }
export type { PnpmRunner }
