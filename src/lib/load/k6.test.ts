import { describe, expect, it } from 'vitest'
import { k6 } from './k6.js'

const PORT = 4173
const SCENARIO = 'k6/load-test.js'
const STRESS_SCENARIO = 'k6/stress-test.js'

describe('k6 argv builders', () => {
	it('targets the given port on loopback', () => {
		expect(k6.build_target_url(PORT)).toBe('http://127.0.0.1:4173')
	})

	it('runs the scenario with the target handed in as BASE_URL', () => {
		const argv = k6.build_run_argv(SCENARIO, PORT)

		expect(argv).toEqual(['run', '--env', 'BASE_URL=http://127.0.0.1:4173', SCENARIO])
	})

	it('runs whatever scenario path it is given (baseline, stress, or a custom one)', () => {
		const argv = k6.build_run_argv(STRESS_SCENARIO, PORT)

		expect(argv.at(-1)).toBe(STRESS_SCENARIO)
	})

	it('runs `k6 version` as the preflight so a missing binary fails before build + boot', () => {
		expect(k6.PREFLIGHT_ARGV).toEqual(['version'])
	})

	it("forces no thresholds on the command line — report-only is the scenario's choice", () => {
		const argv = k6.build_run_argv(SCENARIO, PORT)

		expect(argv.join(' ')).not.toContain('threshold')
	})
})
