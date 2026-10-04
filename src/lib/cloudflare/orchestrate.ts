import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { resolve_effective_upstream_version } from '@joshuafolkken/kit/version'
import { process_runner } from '#process/runner.js'

const ENCODING = 'utf8'
const MANIFEST = 'package.json'
const KIT_PACKAGE_NAME = '@joshuafolkken/kit'
const BIN_NAME = 'josh'

// kit's `package.json` is blocked by its `exports`, so resolve a real public entry and walk up to
// the package root from there. config-merge (the library app-kit also consumes) is always present.
const KIT_RESOLVE_MARKER = '@joshuafolkken/kit/config-merge'

// `josh init` accepts only `--profile` (plus `--no-install`) and otherwise infers the profile from
// package.json, which reads a bare package.json as `basic`. The overlay always yields a SvelteKit
// project, so request the full toolchain explicitly. `node` is the pre-rename spelling of `full`
// (joshuafolkken/kit#2829): every kit with `--profile` reads it, while `full` only reads on kits
// after the rename, and the kit that runs here can be any version the peer range allows.
const FULL_PROFILE_ARGS: ReadonlyArray<string> = ['--profile', 'node']

// `josh start` runs this in place of its own `josh init`, resolved through PATH: the project's copy
// under `pnpm exec josh-app start`, the global one otherwise.
const INIT_COMMAND_FLAG = '--init-command'
const INIT_COMMAND = 'josh-app init'
// Fixed for the same reason as FULL_PROFILE_ARGS, so kit's detection never picks `basic` for an
// empty directory. Every kit with `--init-command` (1.1050.0+) already reads the renamed `full`.
const START_PROFILE_ARGS: ReadonlyArray<string> = ['--profile', 'full']

const SUCCESS_STATUS = 0

interface SpawnOutcome {
	status: number | null
	error: Error | undefined
}

type SpawnRunner = (bin: string, argv: ReadonlyArray<string>, cwd: string) => SpawnOutcome

const NAME_FIELD = 'name'
const BIN_FIELD = 'bin'

function is_record(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

// Read one top-level field from a package.json. A variable key keeps `noPropertyAccessFromIndex-
// Signature` (bracket access) and the `dot-notation` lint rule (no literal-key bracket) both happy.
function read_manifest_field(manifest_path: string, field: string): unknown {
	const parsed: unknown = JSON.parse(readFileSync(manifest_path, ENCODING))

	return is_record(parsed) ? parsed[field] : undefined
}

// Walk up from `start` until a package.json whose `name` matches is found, returning its directory.
function find_package_root(start: string, name: string): string | undefined {
	let directory = start

	while (directory !== path.dirname(directory)) {
		const manifest_path = path.join(directory, MANIFEST)

		if (existsSync(manifest_path) && read_manifest_field(manifest_path, NAME_FIELD) === name) {
			return directory
		}

		directory = path.dirname(directory)
	}

	return undefined
}

function read_bin_path(root: string): string {
	const bin = read_manifest_field(path.join(root, MANIFEST), BIN_FIELD)
	if (typeof bin === 'string') return bin

	if (is_record(bin)) {
		const resolved = bin[BIN_NAME]
		if (typeof resolved === 'string') return resolved
	}

	throw new Error(`${KIT_PACKAGE_NAME} declares no ${BIN_NAME} bin`)
}

// Resolve kit's package root relative to the running app-kit binary. `createRequire(import.meta.url)`
// resolves against the running bundle, so this is the *effective* kit — the copy `sync` actually runs
// (global app-kit → its bundled kit; project app-kit → the project's kit).
function resolve_kit_root(): string {
	const require = createRequire(import.meta.url)
	const marker = require.resolve(KIT_RESOLVE_MARKER)
	const root = find_package_root(path.dirname(marker), KIT_PACKAGE_NAME)
	if (root === undefined) throw new Error(`Cannot locate ${KIT_PACKAGE_NAME} from ${marker}`)

	return root
}

// Resolve the absolute path to kit's `josh` CLI entry inside the effective kit.
function resolve_kit_josh_bin(): string {
	const root = resolve_kit_root()

	return path.join(root, read_bin_path(root))
}

// Read the effective (running-relative) kit version, or undefined when kit cannot be located — never
// guess. `josh-app v`/`vu` use this to report kit's effective Global line (kit#648 / app-kit#83).
// Single-sourced from kit's own walk-up primitive (kit#651) rather than a private copy: it resolves
// the marker via createRequire against this bundle and returns kit's version, and never throws.
function resolve_kit_effective_version(): string | undefined {
	return resolve_effective_upstream_version(import.meta.url, KIT_PACKAGE_NAME, {
		resolve_marker: KIT_RESOLVE_MARKER,
	})
}

function default_spawn(bin: string, argv: ReadonlyArray<string>, cwd: string): SpawnOutcome {
	const result = spawnSync(process.execPath, [bin, ...argv], { cwd, stdio: 'inherit' })

	return { status: result.status, error: result.error }
}

function assert_success(command: string, outcome: SpawnOutcome): void {
	if (outcome.error !== undefined) throw outcome.error

	if (outcome.status !== SUCCESS_STATUS) {
		throw new Error(`josh ${command} exited with status ${String(outcome.status)}`)
	}
}

// Run kit's framework-agnostic base command (`josh <command>`) as a subprocess in the consumer
// project, so app-kit delegates the base layer instead of duplicating kit's file list. Throws when
// the subprocess fails. `spawn` is injectable so the orchestration is unit-testable without a fork.
function run_kit_base(
	command: string,
	args: ReadonlyArray<string>,
	cwd: string,
	spawn: SpawnRunner = default_spawn,
): void {
	const bin = resolve_kit_josh_bin()

	assert_success(command, spawn(bin, [command, ...args], cwd))
}

function run_base_sync(cwd: string, spawn: SpawnRunner = default_spawn): void {
	run_kit_base('sync', [], cwd, spawn)
}

// `profile_args` is the `--profile <profile>` pair `josh start` appends to its initialize command;
// a bare `josh-app init` has none and keeps requesting the full toolchain.
function run_base_init(
	cwd: string,
	profile_args: ReadonlyArray<string> = [],
	spawn: SpawnRunner = default_spawn,
): void {
	run_kit_base('init', profile_args.length > 0 ? profile_args : FULL_PROFILE_ARGS, cwd, spawn)
}

// Run kit's `josh start` with `josh-app init` as its initialize step, so kit keeps every guard and
// GitHub step in one place and app-kit only names its own setup (joshuafolkken/kit#2872). The
// caller's options pass through untouched; kit validates them. The exit status is returned rather
// than thrown, because kit has already printed why it refused.
function run_base_start(
	cwd: string,
	args: ReadonlyArray<string>,
	spawn: SpawnRunner = default_spawn,
): number {
	const argv = ['start', INIT_COMMAND_FLAG, INIT_COMMAND, ...START_PROFILE_ARGS, ...args]

	return process_runner.to_exit_status(spawn(resolve_kit_josh_bin(), argv, cwd))
}

const cloudflare_orchestrate = {
	find_package_root,
	resolve_kit_josh_bin,
	resolve_kit_effective_version,
	run_kit_base,
	run_base_sync,
	run_base_init,
	run_base_start,
}

export { cloudflare_orchestrate }
export type { SpawnOutcome, SpawnRunner }
