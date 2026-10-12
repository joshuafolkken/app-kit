import { process_runner, type CommandRunner } from '#process/runner.js'
import type { OverlayChange } from './sync.js'

// This install exists to rewrite the lockfile, and pnpm freezes it wherever `CI` is set: a bare
// `pnpm install` there exits 1 on the very mismatch it was spawned to repair.
const INSTALL_ARGV: ReadonlyArray<string> = ['install', '--no-frozen-lockfile']
const INSTALL_COMMAND = `pnpm ${INSTALL_ARGV.join(' ')}`

function has_added_dependency(changes: ReadonlyArray<OverlayChange>): boolean {
	return changes.some((change) => (change.dependencies ?? []).length > 0)
}

// kit's base step installs before the overlay runs, so a dependency the overlay adds reaches
// package.json alone — the lockfile and node_modules lack it, `pnpm install --frozen-lockfile`
// fails, and the first commit carries a lockfile the next install rewrites (#282). Install once
// more, only when the overlay actually added one: a re-run on an overlaid project spawns nothing.
// Returns whether it installed. `run` is injectable so this is unit-testable without a fork.
function install_added_dependencies(
	changes: ReadonlyArray<OverlayChange>,
	cwd: string,
	run: CommandRunner = process_runner.run_pnpm,
): boolean {
	if (!has_added_dependency(changes)) return false

	const status = process_runner.to_exit_status(run(INSTALL_ARGV, cwd))

	if (status !== process_runner.SUCCESS_STATUS) {
		throw new Error(
			`pnpm install exited with status ${String(status)} — package.json lists a dependency pnpm-lock.yaml lacks; fix the cause above, then run: ${INSTALL_COMMAND}`,
		)
	}

	return true
}

const cloudflare_install = { INSTALL_ARGV, install_added_dependencies }

export { cloudflare_install }
