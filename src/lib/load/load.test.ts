import type { SpawnOutcome } from '#cloudflare/orchestrate.js'
import { port_seed_fixture } from '#dast/port-seed-fixture.js'
import type { PreviewHandle } from '#dast/preview.js'
import { EnvironmentError } from '#process/environment-error.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { app_load, type LoadDependencies } from './load.js'

const CWD = '/consumer/project'
const SUCCESS = 0
const BUILD_FAILURE = 2
const K6_THRESHOLD_EXIT = 99

const STRESS_SCENARIO = 'k6/stress-test.js'
const VERSION_ARGV_HEAD = 'version'
// The scenario run is the k6 call AFTER the preflight (`k6 version`) at index 0.
const RUN_CALL_INDEX = 1

const { BASE_PREVIEW_PORT, TEST_SEED, SEEDED_PREVIEW_PORT } = port_seed_fixture
const seed = port_seed_fixture.isolate()

// The scenario's target, as k6.build_target_url renders it into `--env BASE_URL=...`.
function target_environment(port: number): string {
	return `BASE_URL=http://127.0.0.1:${String(port)}`
}

const K6_MISSING_PATTERN = /requires the k6/u
const SCENARIO_MISSING_PATTERN = /could not find the k6 scenario/u

interface HarnessOptions {
	// A missing binary makes the preflight (`k6 version`) fail with a spawn error.
	k6_missing?: boolean
	has_scenario?: boolean
	build_status?: number
	// The scenario run (`k6 run ...`) exit status; a report-only scenario yields 0.
	run_status?: number
}

interface HarnessState {
	k6_argv: Array<ReadonlyArray<string>>
	pnpm_argv: Array<ReadonlyArray<string>>
	preview_ports: Array<number>
	boots: number
	stops: number
}

function no_output(): string {
	return ''
}

function make_state(): HarnessState {
	return { k6_argv: [], pnpm_argv: [], preview_ports: [], boots: 0, stops: 0 }
}

function preflight_outcome(options: HarnessOptions): SpawnOutcome {
	// A spawn ENOENT (the CLI is absent) reports a null status alongside the error.
	// eslint-disable-next-line unicorn/no-null -- SpawnOutcome.status is number | null
	if (options.k6_missing ?? false) return { status: null, error: new Error('spawn k6 ENOENT') }

	return { status: SUCCESS, error: undefined }
}

function make_dependencies(state: HarnessState, options: HarnessOptions): LoadDependencies {
	function stop(): void {
		state.stops += 1
	}

	function k6_run(argv: ReadonlyArray<string>): SpawnOutcome {
		state.k6_argv.push(argv)

		if (argv[0] === VERSION_ARGV_HEAD) return preflight_outcome(options)

		return { status: options.run_status ?? SUCCESS, error: undefined }
	}

	function pnpm(argv: ReadonlyArray<string>): SpawnOutcome {
		state.pnpm_argv.push(argv)

		return { status: options.build_status ?? SUCCESS, error: undefined }
	}

	async function start_preview(_cwd: string, port: number): Promise<PreviewHandle> {
		state.boots += 1
		state.preview_ports.push(port)

		return { stop, output: no_output, has_exited: () => false, group_id: () => undefined }
	}

	function has_scenario(): boolean {
		return options.has_scenario ?? true
	}

	return { k6_run, pnpm, start_preview, has_scenario }
}

function make_harness(options: HarnessOptions = {}): {
	state: HarnessState
	deps: LoadDependencies
} {
	const state = make_state()

	return { state, deps: make_dependencies(state, options) }
}

function run_argv(state: HarnessState): ReadonlyArray<string> {
	return state.k6_argv[RUN_CALL_INDEX] ?? []
}

describe('josh-app load — prerequisites', () => {
	it('fails loudly and skips build + boot when k6 is not installed', async () => {
		const { state, deps } = make_harness({ k6_missing: true })

		await expect(app_load.run_load(CWD, app_load.SCENARIO_FILE, deps)).rejects.toThrow(
			K6_MISSING_PATTERN,
		)
		expect(state.pnpm_argv).toHaveLength(0)
		expect(state.boots).toBe(0)
	})

	it('raises a typed environment error so the CLI reports it without a stack trace', async () => {
		const { deps } = make_harness({ k6_missing: true })

		await expect(app_load.run_load(CWD, app_load.SCENARIO_FILE, deps)).rejects.toBeInstanceOf(
			EnvironmentError,
		)
	})

	it('fails loudly, naming the missing scenario, and skips build + boot', async () => {
		const { state, deps } = make_harness({ has_scenario: false })

		const failure = app_load.run_load(CWD, STRESS_SCENARIO, deps)

		await expect(failure).rejects.toThrow(SCENARIO_MISSING_PATTERN)
		// The error names the scenario that was actually requested, not just the default.
		await expect(failure).rejects.toThrow(STRESS_SCENARIO)
		expect(state.pnpm_argv).toHaveLength(0)
		expect(state.boots).toBe(0)
	})
})

describe('josh-app load — run pipeline', () => {
	it('returns the build status and never boots the preview when the build fails', async () => {
		const { state, deps } = make_harness({ build_status: BUILD_FAILURE })

		expect(await app_load.run_load(CWD, app_load.SCENARIO_FILE, deps)).toBe(BUILD_FAILURE)
		expect(state.boots).toBe(0)
		expect(run_argv(state)).toHaveLength(0)
	})

	it('runs the default seeded scenario when none is given', async () => {
		const { state, deps } = make_harness()

		expect(await app_load.run_load(CWD, undefined, deps)).toBe(SUCCESS)
		expect(state.boots).toBe(1)
		expect(state.stops).toBe(1)
		expect(run_argv(state)).toEqual([
			'run',
			'--env',
			target_environment(BASE_PREVIEW_PORT),
			app_load.SCENARIO_FILE,
		])
	})

	it('runs the scenario it is handed (e.g. the stress variant)', async () => {
		const { state, deps } = make_harness()

		expect(await app_load.run_load(CWD, STRESS_SCENARIO, deps)).toBe(SUCCESS)
		expect(run_argv(state)).toContain(STRESS_SCENARIO)
	})

	it('exposes the stress scenario path the load:stress command runs', () => {
		// `josh-app load:stress` is `run_load(cwd, STRESS_SCENARIO_FILE)`; the test above proves
		// run_load honours whatever path it is handed, so pinning the constant covers the command.
		expect(app_load.STRESS_SCENARIO_FILE).toBe(STRESS_SCENARIO)
	})

	it('tears the preview down even when k6 exits non-zero (a threshold failure)', async () => {
		const { state, deps } = make_harness({ run_status: K6_THRESHOLD_EXIT })

		expect(await app_load.run_load(CWD, app_load.SCENARIO_FILE, deps)).toBe(K6_THRESHOLD_EXIT)
		expect(state.stops).toBe(1)
	})
})

// app-kit#177: the port comes from kit's single definition, not a literal in load.ts. CWD has no
// `.env`, so the seed reaches the resolver through process.env — which is what `PORT_SEED=1
// josh-app load` sets anyway. Restored after each test because the value is global.
describe('josh-app load — preview port', () => {
	beforeEach(seed.clear)
	afterEach(seed.restore)

	it('boots and targets the historical 4173 when no seed is set', async () => {
		const { state, deps } = make_harness()

		await app_load.run_load(CWD, undefined, deps)

		expect(state.preview_ports).toEqual([BASE_PREVIEW_PORT])
		expect(run_argv(state)).toContain(target_environment(BASE_PREVIEW_PORT))
	})

	// Without this the scenario would hammer 4173 while wrangler listens on the seeded port, and
	// every request would be refused — or worse, answered by another project's preview.
	it('follows PORT_SEED so the scenario targets the booted server', async () => {
		seed.set(TEST_SEED)
		const { state, deps } = make_harness()

		await app_load.run_load(CWD, undefined, deps)

		expect(state.preview_ports).toEqual([SEEDED_PREVIEW_PORT])
		expect(run_argv(state)).toContain(target_environment(SEEDED_PREVIEW_PORT))
	})
})

describe('josh-app load — describe_result', () => {
	it('marks a clean run with a success line', () => {
		expect(app_load.describe_result(SUCCESS)).toContain('✅')
	})

	it('surfaces a non-zero k6 status', () => {
		expect(app_load.describe_result(K6_THRESHOLD_EXIT)).toContain('99')
	})
})
