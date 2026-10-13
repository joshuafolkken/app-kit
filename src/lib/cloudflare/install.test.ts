import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cloudflare_install } from './install.js'
import type { SpawnOutcome } from './orchestrate.js'
import { sync_fixture } from './sync-fixture.js'
import { cloudflare_sync, type OverlayChange } from './sync.js'

const { SOURCE_DIR, PACKAGE_JSON } = sync_fixture

const CWD = '/work/consumer-project'
const FAST_CHECK_PACKAGE = 'svelte-fast-check'
const SPAWN_FAILURE = 'spawn ENOENT'
const FAILURE_STATUS = 1
// Spelled out rather than read from the module: under `CI` pnpm freezes the lockfile, so dropping
// the flag would make the install fail on exactly the mismatch it is there to repair.
const INSTALL_ARGV = ['install', '--no-frozen-lockfile']

const ADAPTER = '@sveltejs/adapter-cloudflare'
// `--save-dev`, and no version: the project's own resolution picks the adapter's range (#291).
const ADD_ARGV = ['add', '--save-dev', ADAPTER]

const OK: SpawnOutcome = { status: 0, error: undefined }
const UNVERSIONED: ReadonlyArray<OverlayChange> = [
	{ file: PACKAGE_JSON, action: 'updated', dependencies: [FAST_CHECK_PACKAGE] },
	{ file: PACKAGE_JSON, action: 'updated', additions: [ADAPTER] },
]
const SEEDED: ReadonlyArray<OverlayChange> = [
	{ file: PACKAGE_JSON, action: 'updated', dependencies: [FAST_CHECK_PACKAGE] },
]
const REMOVED_ONLY: ReadonlyArray<OverlayChange> = [
	{ file: PACKAGE_JSON, action: 'updated', removals: ['@sveltejs/adapter-auto'] },
]
const SCRIPTS_ONLY: ReadonlyArray<OverlayChange> = [
	{ file: PACKAGE_JSON, action: 'updated', scripts: [{ key: 'dev', kind: 'added' }] },
	{ file: 'wrangler.jsonc', action: 'created' },
]

interface RunCall {
	argv: ReadonlyArray<string>
	cwd: string
}

// A pnpm stub that records its arguments and returns a fixed outcome, so the decision is exercised
// without a real install.
function make_run(outcome: SpawnOutcome): {
	run: (argv: ReadonlyArray<string>, cwd: string) => SpawnOutcome
	calls: Array<RunCall>
} {
	const calls: Array<RunCall> = []

	function run(argv: ReadonlyArray<string>, cwd: string): SpawnOutcome {
		calls.push({ argv, cwd })

		return outcome
	}

	return { run, calls }
}

// #282: kit's base step installs before the overlay runs, so the devDependency the overlay seeds
// reached package.json alone. `pnpm install --frozen-lockfile` then failed on a project `josh-app
// init` had just reported as set up, and `josh-app start` committed that lockfile.
describe('cloudflare install — added dependencies (#282)', () => {
	it('runs pnpm install in the project when the overlay added a dependency', () => {
		const { run, calls } = make_run(OK)

		const did_install = cloudflare_install.install_added_dependencies(SEEDED, CWD, run)

		expect(did_install).toBe(true)
		expect(calls).toEqual([{ argv: INSTALL_ARGV, cwd: CWD }])
	})

	it('spawns nothing when the overlay added no dependency', () => {
		const { run, calls } = make_run(OK)

		const did_install = cloudflare_install.install_added_dependencies(SCRIPTS_ONLY, CWD, run)

		expect(did_install).toBe(false)
		expect(calls).toEqual([])
	})

	it('throws when the install exits non-zero', () => {
		const { run } = make_run({ status: FAILURE_STATUS, error: undefined })

		expect(() => cloudflare_install.install_added_dependencies(SEEDED, CWD, run)).toThrow(
			/pnpm install --no-frozen-lockfile exited with status 1.*then run: pnpm install --no-frozen-lockfile$/u,
		)
	})

	it('rethrows when pnpm could not be spawned', () => {
		const { run } = make_run({ status: FAILURE_STATUS, error: new Error(SPAWN_FAILURE) })

		expect(() => cloudflare_install.install_added_dependencies(SEEDED, CWD, run)).toThrow(
			SPAWN_FAILURE,
		)
	})
})

describe('cloudflare install — dependencies app-kit names no version for (#291)', () => {
	it('hands them to one pnpm add, which also installs what the overlay seeded', () => {
		const { run, calls } = make_run(OK)

		const did_install = cloudflare_install.install_added_dependencies(UNVERSIONED, CWD, run)

		expect(did_install).toBe(true)
		expect(calls).toEqual([{ argv: ADD_ARGV, cwd: CWD }])
	})

	// The lockfile keeps a dependency the overlay took out of package.json until an install runs.
	it('runs pnpm install when the overlay only removed a dependency', () => {
		const { run, calls } = make_run(OK)

		const did_install = cloudflare_install.install_added_dependencies(REMOVED_ONLY, CWD, run)

		expect(did_install).toBe(true)
		expect(calls).toEqual([{ argv: INSTALL_ARGV, cwd: CWD }])
	})

	// Not `pnpm install` as the retry: it would succeed on a manifest still missing the adapter.
	it('names pnpm add as the failed command and as the one to run again', () => {
		const { run } = make_run({ status: FAILURE_STATUS, error: undefined })

		function install(): void {
			cloudflare_install.install_added_dependencies(UNVERSIONED, CWD, run)
		}

		expect(install).toThrow(`pnpm add --save-dev ${ADAPTER} exited with status 1`)
		expect(install).toThrow(`then run: pnpm add --save-dev ${ADAPTER}`)
	})
})

describe('cloudflare install — driven by the real overlay (#282)', () => {
	beforeEach(() => {
		sync_fixture.create()
	})

	afterEach(() => {
		sync_fixture.remove()
	})

	it('installs after the first overlay and not after an idempotent re-run', () => {
		const { run, calls } = make_run(OK)
		const directory = sync_fixture.directory()

		const first = cloudflare_sync.apply_overlay(directory, SOURCE_DIR)
		const second = cloudflare_sync.apply_overlay(directory, SOURCE_DIR)

		expect(cloudflare_install.install_added_dependencies(first, directory, run)).toBe(true)
		expect(cloudflare_install.install_added_dependencies(second, directory, run)).toBe(false)
		expect(calls).toEqual([{ argv: INSTALL_ARGV, cwd: directory }])
	})

	it('reports the seeded dependency on the manifest change only', () => {
		const changes = cloudflare_sync.apply_overlay(sync_fixture.directory(), SOURCE_DIR)
		const reporting = changes.filter((change) => change.dependencies !== undefined)

		expect(reporting.map((change) => change.file)).toEqual([PACKAGE_JSON])
		expect(reporting[0]?.dependencies).toEqual([FAST_CHECK_PACKAGE])
	})

	it('reports no dependency when the consumer already pins it', () => {
		sync_fixture.write_manifest({ [FAST_CHECK_PACKAGE]: '0.0.1' })

		const changes = cloudflare_sync.apply_overlay(sync_fixture.directory(), SOURCE_DIR)

		expect(changes.some((change) => change.dependencies !== undefined)).toBe(false)
	})
})
