import type { PreviewHandle } from '#dast/preview.js'
import { EnvironmentError } from '#process/environment-error.js'
import type { VerifyDependencies } from './verify.js'

// The recording stand-ins every `josh-app verify` suite drives the orchestrator with. Test-only,
// but a plain module rather than a `*.test.ts`: it holds no tests of its own, and it is under
// `src/lib/verify/`, which package.json excludes from the published files. Split out of
// verify.test.ts when #283's suite pushed that file past the 300-line cap.

const CWD = '/consumer/project'
const SUCCESS = 0
const E2E_FAILURE = 2
const HEADERS_FILE = '_headers'
const CRASH_CHECK = 'crash-check'

interface VerifyState {
	order: Array<string>
	preview_ports: Array<number>
	scan_ports: Array<number>
	boots: number
	stops: number
	scans: number
	crash_checks: number
	release_waits: number
}

interface VerifyOptions {
	build_status?: number
	e2e_status?: number
	scan_status?: number
	docker_missing?: boolean
	scan_disabled?: boolean
	scan_error?: Error
	scan_statuses?: Array<number>
	crash_verdict?: boolean
	e2e_statuses?: Array<number>
}

function make_stop(state: VerifyState): () => void {
	function stop(): void {
		state.order.push('stop')
		state.stops += 1
	}

	return stop
}

function make_release(state: VerifyState): () => Promise<void> {
	async function wait_for_release(): Promise<void> {
		state.order.push('release')
		state.release_waits += 1
	}

	return wait_for_release
}

function make_preflight(state: VerifyState, options: VerifyOptions): () => void {
	function preflight_docker(): void {
		state.order.push('preflight')
		if (options.docker_missing === true) throw new EnvironmentError('no docker')
	}

	return preflight_docker
}

function make_scan_switch(options: VerifyOptions): () => boolean {
	function is_scan_enabled(): boolean {
		return options.scan_disabled !== true
	}

	return is_scan_enabled
}

// The stand-in server is no process, so it has no process group to report.
const NO_GROUP_IDS: ReadonlyArray<number> = []

function no_group_id(): number | undefined {
	return NO_GROUP_IDS.at(0)
}

type PreviewStarter = VerifyDependencies['start_preview']
type Scanner = VerifyDependencies['scan']

function make_start_preview(state: VerifyState): PreviewStarter {
	const stop = make_stop(state)

	async function start_preview(_cwd: string, port: number): Promise<PreviewHandle> {
		state.order.push('boot')
		state.boots += 1
		state.preview_ports.push(port)

		return { stop, output: () => '', has_exited: () => false, group_id: no_group_id }
	}

	return start_preview
}

function make_scan(state: VerifyState, options: VerifyOptions): Scanner {
	async function scan(_cwd: string, port: number): Promise<number> {
		state.order.push('scan')
		state.scans += 1
		state.scan_ports.push(port)
		if (options.scan_error !== undefined) throw options.scan_error

		return options.scan_statuses?.shift() ?? options.scan_status ?? SUCCESS
	}

	return scan
}

function make_deps(state: VerifyState, options: VerifyOptions): VerifyDependencies {
	return {
		is_scan_enabled: make_scan_switch(options),
		preflight_docker: make_preflight(state, options),
		build(): number {
			state.order.push('build')

			return options.build_status ?? SUCCESS
		},
		start_preview: make_start_preview(state),
		run_e2e(): number {
			state.order.push('e2e')

			return options.e2e_statuses?.shift() ?? options.e2e_status ?? SUCCESS
		},
		has_crashed(): boolean {
			state.order.push(CRASH_CHECK)
			state.crash_checks += 1

			return options.crash_verdict ?? false
		},
		wait_for_release: make_release(state),
		scan: make_scan(state, options),
	}
}

function make_harness(options: VerifyOptions = {}): {
	state: VerifyState
	deps: VerifyDependencies
} {
	const state: VerifyState = {
		order: [],
		preview_ports: [],
		scan_ports: [],
		boots: 0,
		stops: 0,
		scans: 0,
		crash_checks: 0,
		release_waits: 0,
	}

	return { state, deps: make_deps(state, options) }
}

const verify_fixture = {
	CWD,
	SUCCESS,
	E2E_FAILURE,
	HEADERS_FILE,
	CRASH_CHECK,
	make_harness,
}

export { verify_fixture }
