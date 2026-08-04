import { process_runner, type CommandRunner } from '#process/runner.js'

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

// `svelte-kit sync` always runs first so a clean checkout has generated types; the checker only
// runs when sync succeeded, and the first non-zero status becomes the command's exit status.
function run_steps(
	steps: ReadonlyArray<ReadonlyArray<string>>,
	cwd: string,
	spawn: CommandRunner,
): number {
	for (const argv of steps) {
		const status = process_runner.to_exit_status(spawn(argv, cwd))
		if (status !== process_runner.SUCCESS_STATUS) return status
	}

	return process_runner.SUCCESS_STATUS
}

function run_check(cwd: string, spawn: CommandRunner = process_runner.run_pnpm): number {
	return run_steps([SYNC_ARGS, FAST_CHECK_ARGS], cwd, spawn)
}

function run_check_ci(cwd: string, spawn: CommandRunner = process_runner.run_pnpm): number {
	return run_steps([SYNC_ARGS, CI_CHECK_ARGS], cwd, spawn)
}

const app_check = { FAST_CHECK_PACKAGE, run_check, run_check_ci }

export { app_check }
