import type { PreviewHandle } from '#dast/preview.js'
import { EnvironmentError } from '#process/environment-error.js'
import { describe, expect, it } from 'vitest'
import { app_verify, type VerifyDependencies } from './verify.js'

const CWD = '/consumer/project'
const SUCCESS = 0
const BUILD_FAILURE = 1
const E2E_FAILURE = 2
const ZAP_WARN_EXIT = 2

const HEADERS_FILE = '_headers'
const CODE_FILE = 'src/lib/foo.ts'
const SVELTE_FILE = 'src/App.svelte'
const SCAN_CRASH = 'spawn docker EPIPE'

interface VerifyState {
	order: Array<string>
	boots: number
	stops: number
	scans: number
}

interface VerifyOptions {
	build_status?: number
	e2e_status?: number
	scan_status?: number
	docker_missing?: boolean
	scan_error?: Error
}

function make_deps(state: VerifyState, options: VerifyOptions): VerifyDependencies {
	function stop(): void {
		state.order.push('stop')
		state.stops += 1
	}

	return {
		preflight_docker(): void {
			state.order.push('preflight')
			if (options.docker_missing === true) throw new EnvironmentError('no docker')
		},
		build(): number {
			state.order.push('build')

			return options.build_status ?? SUCCESS
		},
		async start_preview(): Promise<PreviewHandle> {
			state.order.push('boot')
			state.boots += 1

			return { stop, output: () => '', has_exited: () => false, group_id: () => undefined }
		},
		run_e2e(): number {
			state.order.push('e2e')

			return options.e2e_status ?? SUCCESS
		},
		async scan(): Promise<number> {
			state.order.push('scan')
			state.scans += 1
			if (options.scan_error !== undefined) throw options.scan_error

			return options.scan_status ?? SUCCESS
		},
	}
}

function make_harness(options: VerifyOptions = {}): {
	state: VerifyState
	deps: VerifyDependencies
} {
	const state: VerifyState = { order: [], boots: 0, stops: 0, scans: 0 }

	return { state, deps: make_deps(state, options) }
}

describe('verify — DAST relevance predicate', () => {
	it('flags every file that can move a ZAP baseline verdict', () => {
		for (const file of [
			'_headers',
			'zap-baseline.conf',
			'wrangler.jsonc',
			'svelte.config.js',
			'src/hooks.server.ts',
			'src/routes/api/+server.ts',
			'src/routes/dashboard/+page.server.ts',
		]) {
			expect(app_verify.is_dast_relevant(file)).toBe(true)
		}
	})

	it('ignores files that cannot change response headers or cookies', () => {
		for (const file of [CODE_FILE, 'package.json', SVELTE_FILE, 'README.md']) {
			expect(app_verify.is_dast_relevant(file)).toBe(false)
		}
	})

	it('skips the scan for a code-only push but keeps E2E', () => {
		expect(app_verify.should_scan([CODE_FILE, SVELTE_FILE])).toBe(false)
	})

	it('scans when any pushed file is header/cookie-relevant', () => {
		expect(app_verify.should_scan([CODE_FILE, HEADERS_FILE])).toBe(true)
	})

	it('scans on an empty file list as a fail-safe (never skip a security check silently)', () => {
		expect(app_verify.should_scan([])).toBe(true)
	})
})

describe('verify — pipeline order & fan-out', () => {
	it('builds once, boots once, then fans out the scan and E2E (scan started before E2E)', async () => {
		const { state, deps } = make_harness()

		await app_verify.run_verify(CWD, [HEADERS_FILE], deps)

		// The scan container is spawned (non-blocking) BEFORE the synchronous E2E, so the two
		// overlap against the one server — 'scan' is recorded before 'e2e'.
		expect(state.order).toEqual(['preflight', 'build', 'boot', 'scan', 'e2e', 'stop'])
		expect(state.boots).toBe(1)
	})

	it('skips the scan (and Docker preflight) on a code-only push, still running E2E', async () => {
		const { state, deps } = make_harness()

		const status = await app_verify.run_verify(CWD, [CODE_FILE], deps)

		expect(state.order).toEqual(['build', 'boot', 'e2e', 'stop'])
		expect(state.scans).toBe(0)
		expect(status).toBe(SUCCESS)
	})
})

describe('verify — short-circuiting & exit aggregation', () => {
	it('does not build or boot when the scan is required but Docker is missing', async () => {
		const { state, deps } = make_harness({ docker_missing: true })

		await expect(app_verify.run_verify(CWD, [HEADERS_FILE], deps)).rejects.toBeInstanceOf(
			EnvironmentError,
		)
		expect(state.order).toEqual(['preflight'])
	})

	it('returns the build status without booting when the build fails', async () => {
		const { state, deps } = make_harness({ build_status: BUILD_FAILURE })

		const status = await app_verify.run_verify(CWD, [CODE_FILE], deps)

		expect(status).toBe(BUILD_FAILURE)
		expect(state.boots).toBe(0)
	})

	it('still runs the scan when E2E fails — a header regression is not masked by a test failure', async () => {
		// Fan-out means E2E no longer short-circuits the scan: both run, both are reported.
		const { state, deps } = make_harness({ e2e_status: E2E_FAILURE })

		const status = await app_verify.run_verify(CWD, [HEADERS_FILE], deps)

		expect(status).toBe(E2E_FAILURE)
		expect(state.scans).toBe(1)
		expect(state.stops).toBe(1)
	})

	it('fails the push when the scan reports a finding, even though E2E passed', async () => {
		const { deps } = make_harness({ scan_status: ZAP_WARN_EXIT })

		expect(await app_verify.run_verify(CWD, [HEADERS_FILE], deps)).toBe(ZAP_WARN_EXIT)
	})

	it('fails when both E2E and the scan fail', async () => {
		const { deps } = make_harness({ e2e_status: E2E_FAILURE, scan_status: ZAP_WARN_EXIT })

		expect(await app_verify.run_verify(CWD, [HEADERS_FILE], deps)).not.toBe(SUCCESS)
	})

	it('passes only when both E2E and the scan pass', async () => {
		const { deps } = make_harness()

		expect(await app_verify.run_verify(CWD, [HEADERS_FILE], deps)).toBe(SUCCESS)
	})
})

describe('verify — teardown', () => {
	it('tears the shared server down after a passing run', async () => {
		const { state, deps } = make_harness()

		await app_verify.run_verify(CWD, [HEADERS_FILE], deps)

		expect(state.stops).toBe(1)
	})

	it('tears the shared server down even when the scan throws', async () => {
		// A crash mid-scan must not leave wrangler holding port 4173 for the next run.
		const { state, deps } = make_harness({ scan_error: new Error(SCAN_CRASH) })

		await expect(app_verify.run_verify(CWD, [HEADERS_FILE], deps)).rejects.toThrow(/EPIPE/u)
		expect(state.stops).toBe(1)
	})
})
