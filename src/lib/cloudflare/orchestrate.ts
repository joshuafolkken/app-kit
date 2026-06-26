import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const ENCODING = 'utf8'
const MANIFEST = 'package.json'
const KIT_PACKAGE_NAME = '@joshuafolkken/kit'
const BIN_NAME = 'josh'

// kit's `package.json` is blocked by its `exports`, so resolve a real public entry and walk up to
// the package root from there. config-merge (the library app-kit also consumes) is always present.
const KIT_RESOLVE_MARKER = '@joshuafolkken/kit/config-merge'

// `josh init` prompts for the project type when it cannot auto-detect; pass it explicitly so the
// orchestrated run is always non-interactive.
const SVELTEKIT_TYPE_ARGS: ReadonlyArray<string> = ['--type', 'sveltekit']

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

// Resolve the absolute path to kit's `josh` CLI entry inside the consumer's installed kit.
function resolve_kit_josh_bin(): string {
	const require = createRequire(import.meta.url)
	const marker = require.resolve(KIT_RESOLVE_MARKER)
	const root = find_package_root(path.dirname(marker), KIT_PACKAGE_NAME)
	if (root === undefined) throw new Error(`Cannot locate ${KIT_PACKAGE_NAME} from ${marker}`)

	return path.join(root, read_bin_path(root))
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

function run_base_init(cwd: string, spawn: SpawnRunner = default_spawn): void {
	run_kit_base('init', SVELTEKIT_TYPE_ARGS, cwd, spawn)
}

const cloudflare_orchestrate = {
	resolve_kit_josh_bin,
	run_kit_base,
	run_base_sync,
	run_base_init,
}

export { cloudflare_orchestrate }
export type { SpawnOutcome, SpawnRunner }
