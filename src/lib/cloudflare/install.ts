import { process_runner, type CommandRunner } from '#process/runner.js'
import type { OverlayChange } from './sync.js'

// This install exists to rewrite the lockfile, and pnpm freezes it wherever `CI` is set: a bare
// `pnpm install` there exits 1 on the very mismatch it was spawned to repair.
const INSTALL_ARGV: ReadonlyArray<string> = ['install', '--no-frozen-lockfile']

// `pnpm add` rather than a range written into package.json: these are the dependencies app-kit
// names no range for (#291). It resolves the whole manifest as it goes, so one run also brings in
// anything else the overlay added and drops what it removed.
const ADD_ARGV: ReadonlyArray<string> = ['add', '--save-dev']

function additions_of(changes: ReadonlyArray<OverlayChange>): Array<string> {
	return changes.flatMap((change) => change.additions ?? [])
}

// A dependency written into package.json or taken out of it: either way the lockfile disagrees.
function owes_install(changes: ReadonlyArray<OverlayChange>): boolean {
	return changes.some(
		(change) => (change.dependencies ?? []).length > 0 || (change.removals ?? []).length > 0,
	)
}

function install_argv(changes: ReadonlyArray<OverlayChange>): ReadonlyArray<string> | undefined {
	const additions = additions_of(changes)
	if (additions.length > 0) return [...ADD_ARGV, ...additions]

	return owes_install(changes) ? INSTALL_ARGV : undefined
}

// kit's base step installs before the overlay runs, so a dependency the overlay adds reaches
// package.json alone — the lockfile and node_modules lack it, `pnpm install --frozen-lockfile`
// fails, and the first commit carries a lockfile the next install rewrites (#282). Install once
// more, only when the overlay actually added or removed one: a re-run on an overlaid project spawns
// nothing.
// Returns whether it installed. `run` is injectable so this is unit-testable without a fork.
function install_added_dependencies(
	changes: ReadonlyArray<OverlayChange>,
	cwd: string,
	run: CommandRunner = process_runner.run_pnpm,
): boolean {
	const argv = install_argv(changes)
	if (argv === undefined) return false

	// The command to run again is the one that failed: after a failed `pnpm add`, a plain install
	// would settle the lockfile on a manifest that still lacks the dependency.
	const command = `pnpm ${argv.join(' ')}`
	const status = process_runner.to_exit_status(run(argv, cwd))

	if (status !== process_runner.SUCCESS_STATUS) {
		throw new Error(
			`${command} exited with status ${String(status)} — package.json and pnpm-lock.yaml no longer agree; fix the cause above, then run: ${command}`,
		)
	}

	return true
}

const cloudflare_install = { INSTALL_ARGV, ADD_ARGV, install_added_dependencies }

export { cloudflare_install }
