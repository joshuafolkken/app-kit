import type { SpawnOutcome } from '#cloudflare/orchestrate.js'
import { EnvironmentError } from '#process/environment-error.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { app_dast, type DastDependencies, type ZapWorkspace } from './dast.js'
import { port_seed_fixture } from './port-seed-fixture.js'
import type { PreviewHandle } from './preview.js'

const CWD = '/consumer/project'
const SUCCESS = 0
const BUILD_FAILURE = 1
const ZAP_WARN_EXIT = 2

const ZAP_CONFIG_FILE = 'zap-baseline.conf'
const BUILD_ARGV = ['run', 'build']
// Not under /tmp: this is an inert fixture path that is never created, and pointing test data at
// a world-writable directory trips the publicly-writable-directories rule.
const WORKSPACE_DIR = '/fixture/zap-workspace'
const WORKSPACE_MOUNT = `${WORKSPACE_DIR}:/zap/wrk:rw`

const SCAN_CRASH = 'spawn docker EPIPE'
const DOCKER_MISSING_PATTERN = /requires a running Docker/u

const { BASE_PREVIEW_PORT, TEST_SEED, SEEDED_PREVIEW_PORT } = port_seed_fixture
const seed = port_seed_fixture.isolate()

// The scan's `-t` target, as zap.build_scan_argv renders it.
function target_url(port: number): string {
	return `http://host.docker.internal:${String(port)}`
}

// The preflight is docker call #1; the scan is #2.
const PREFLIGHT_CALL_COUNT = 1
const SCAN_CALL_INDEX = 1

interface HarnessOptions {
	docker_statuses?: ReadonlyArray<number>
	docker_error?: Error
	// Applied to the scan call only, so the preflight can pass and the scan still blow up.
	scan_error?: Error
	build_status?: number
	has_config?: boolean
}

interface HarnessState {
	docker_argv: Array<ReadonlyArray<string>>
	pnpm_argv: Array<ReadonlyArray<string>>
	preview_ports: Array<number>
	stops: number
	boots: number
	opens: number
	closes: number
}

// The dast orchestrator never reads the server buffer; preview.test.ts covers that path.
function no_output(): string {
	return ''
}

function make_state(): HarnessState {
	return {
		docker_argv: [],
		pnpm_argv: [],
		preview_ports: [],
		stops: 0,
		boots: 0,
		opens: 0,
		closes: 0,
	}
}

// Both docker paths record into docker_argv (preflight at [0], scan at [SCAN_CALL_INDEX]) and read
// their scripted status by call index; only the injected error differs.
function record_docker(
	state: HarnessState,
	options: HarnessOptions,
	argv: ReadonlyArray<string>,
	error: Error | undefined,
): SpawnOutcome {
	state.docker_argv.push(argv)

	return { status: options.docker_statuses?.[state.docker_argv.length - 1] ?? SUCCESS, error }
}

function make_dependencies(state: HarnessState, options: HarnessOptions): DastDependencies {
	// Preflight (`docker info`) is synchronous; the scan container run is async.
	function docker(argv: ReadonlyArray<string>): SpawnOutcome {
		return record_docker(state, options, argv, options.docker_error)
	}

	async function docker_scan(argv: ReadonlyArray<string>): Promise<SpawnOutcome> {
		return record_docker(state, options, argv, options.scan_error)
	}

	function pnpm(argv: ReadonlyArray<string>): SpawnOutcome {
		state.pnpm_argv.push(argv)

		return { status: options.build_status ?? SUCCESS, error: undefined }
	}

	function stop(): void {
		state.stops += 1
	}

	async function start_preview(_cwd: string, port: number): Promise<PreviewHandle> {
		state.boots += 1
		state.preview_ports.push(port)

		return { stop, output: no_output, has_exited: () => false, group_id: () => undefined }
	}

	function open_workspace(): ZapWorkspace {
		state.opens += 1
		const config_file = (options.has_config ?? true) ? ZAP_CONFIG_FILE : undefined

		return { directory: WORKSPACE_DIR, config_file }
	}

	function close_workspace(): void {
		state.closes += 1
	}

	return { docker, docker_scan, pnpm, start_preview, open_workspace, close_workspace }
}

function make_harness(options: HarnessOptions = {}): {
	state: HarnessState
	deps: DastDependencies
} {
	const state = make_state()

	return { state, deps: make_dependencies(state, options) }
}

function scan_argv(state: HarnessState): ReadonlyArray<string> {
	return state.docker_argv[SCAN_CALL_INDEX] ?? []
}

describe('josh-app dast — Docker preflight', () => {
	it('fails loudly when the Docker daemon is not running', async () => {
		const { deps } = make_harness({ docker_statuses: [BUILD_FAILURE] })

		await expect(app_dast.run_dast(CWD, deps)).rejects.toThrow(DOCKER_MISSING_PATTERN)
	})

	it('fails loudly when the Docker CLI is missing entirely', async () => {
		const { deps } = make_harness({ docker_error: new Error('spawn docker ENOENT') })

		await expect(app_dast.run_dast(CWD, deps)).rejects.toThrow(DOCKER_MISSING_PATTERN)
	})

	it('raises a typed environment error so the CLI can report it without a stack trace', async () => {
		// A distinct type keeps the friendly presentation from also swallowing the stack trace of
		// a genuine defect.
		const { deps } = make_harness({ docker_statuses: [BUILD_FAILURE] })

		await expect(app_dast.run_dast(CWD, deps)).rejects.toBeInstanceOf(EnvironmentError)
	})

	it('never silently skips the scan — no build, no boot when Docker is unavailable', async () => {
		const { state, deps } = make_harness({ docker_statuses: [BUILD_FAILURE] })

		await expect(app_dast.run_dast(CWD, deps)).rejects.toThrow()
		expect(state.pnpm_argv).toHaveLength(0)
		expect(state.boots).toBe(0)
	})
})

describe('josh-app dast — scan pipeline', () => {
	it('builds before booting the preview server', async () => {
		const { state, deps } = make_harness()

		await app_dast.run_dast(CWD, deps)

		expect(state.pnpm_argv).toEqual([BUILD_ARGV])
		expect(state.boots).toBe(1)
	})

	it('returns success when the scan reports nothing', async () => {
		const { deps } = make_harness()

		await expect(app_dast.run_dast(CWD, deps)).resolves.toBe(SUCCESS)
	})

	it('short-circuits on a build failure without booting or scanning', async () => {
		const { state, deps } = make_harness({ build_status: BUILD_FAILURE })

		await expect(app_dast.run_dast(CWD, deps)).resolves.toBe(BUILD_FAILURE)
		expect(state.boots).toBe(0)
		expect(state.docker_argv).toHaveLength(PREFLIGHT_CALL_COUNT)
	})

	it('fails the command when the baseline scan reports a finding', async () => {
		// zap-baseline.py exits 2 on WARN, 1 on FAIL — both must fail the command.
		const { deps } = make_harness({ docker_statuses: [SUCCESS, ZAP_WARN_EXIT] })

		await expect(app_dast.run_dast(CWD, deps)).resolves.toBe(ZAP_WARN_EXIT)
	})

	it('omits the config flag when the project has no baseline file', async () => {
		const { state, deps } = make_harness({ has_config: false })

		await app_dast.run_dast(CWD, deps)

		expect(scan_argv(state)).not.toContain('-c')
	})
})

describe('josh-app dast — teardown', () => {
	it('tears the preview server down after a passing scan', async () => {
		const { state, deps } = make_harness()

		await app_dast.run_dast(CWD, deps)

		expect(state.stops).toBe(1)
	})

	it('tears the preview server down after a failing scan', async () => {
		const { state, deps } = make_harness({ docker_statuses: [SUCCESS, ZAP_WARN_EXIT] })

		await app_dast.run_dast(CWD, deps)

		expect(state.stops).toBe(1)
	})

	it('tears the preview server down even when the scan throws', async () => {
		// A scan that dies mid-run must not leave wrangler holding port 4173, which would break
		// every later run on the machine.
		const { state, deps } = make_harness({ scan_error: new Error(SCAN_CRASH) })

		await expect(app_dast.run_dast(CWD, deps)).rejects.toThrow(/EPIPE/u)
		expect(state.stops).toBe(1)
	})

	it('discards the scan workspace even when the scan throws', async () => {
		const { state, deps } = make_harness({ scan_error: new Error(SCAN_CRASH) })

		await expect(app_dast.run_dast(CWD, deps)).rejects.toThrow()
		expect(state.closes).toBe(state.opens)
	})
})

describe('josh-app dast — scan workspace', () => {
	it('mounts the throwaway workspace, never the project directory', async () => {
		// Regression: mounting the project at /zap/wrk let zap-baseline.py write its generated
		// zap.yaml plan into the repo on every scan, and handed the scanner container write access
		// to the whole source tree.
		const { state, deps } = make_harness()

		await app_dast.run_dast(CWD, deps)

		expect(scan_argv(state)).toContain(WORKSPACE_MOUNT)
		expect(scan_argv(state).join(' ')).not.toContain(CWD)
	})

	it('always closes the workspace it opened', async () => {
		const { state, deps } = make_harness()

		await app_dast.run_dast(CWD, deps)

		expect(state.opens).toBe(1)
		expect(state.closes).toBe(1)
	})
})

// app-kit#177: the port is kit's single definition, not a literal in this file. The seed reaches
// the resolver through process.env here — CWD has no `.env` — and an environment variable is what
// `PORT_SEED=1 josh-app dast` sets anyway. Restored after each test because the value is global.
describe('josh-app dast — preview port', () => {
	beforeEach(seed.clear)
	afterEach(seed.restore)

	it('boots and scans the historical 4173 when no seed is set', async () => {
		const { state, deps } = make_harness()

		await app_dast.run_dast(CWD, deps)

		expect(state.preview_ports).toEqual([BASE_PREVIEW_PORT])
		expect(scan_argv(state)).toContain(target_url(BASE_PREVIEW_PORT))
	})

	// The whole point of the single definition: Playwright resolves the seeded port from the same
	// kit module, so the scan must not stay behind on 4173 while wrangler listens on 4174.
	it('follows PORT_SEED so the scan targets the same port Playwright resolves', async () => {
		seed.set(TEST_SEED)
		const { state, deps } = make_harness()

		await app_dast.run_dast(CWD, deps)

		expect(state.preview_ports).toEqual([SEEDED_PREVIEW_PORT])
		expect(scan_argv(state)).toContain(target_url(SEEDED_PREVIEW_PORT))
	})
})

describe('josh-app dast — result reporting', () => {
	// The ZAP summary is followed by whatever the torn-down preview server prints, so the closing
	// line has to state the outcome rather than leaving the last line to chance.
	it('states plainly that a clean scan passed', () => {
		expect(app_dast.describe_result(SUCCESS)).toContain('passed')
	})

	it('states plainly that a scan with findings failed, and names the status', () => {
		const described = app_dast.describe_result(ZAP_WARN_EXIT)

		expect(described).toContain('failed')
		expect(described).toContain(String(ZAP_WARN_EXIT))
	})

	it('never calls a failure a pass', () => {
		expect(app_dast.describe_result(ZAP_WARN_EXIT)).not.toContain('passed')
	})
})
