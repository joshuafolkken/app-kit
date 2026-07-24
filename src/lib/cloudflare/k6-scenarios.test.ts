import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { k6_scenarios } from './k6-scenarios.js'

const ENCODING = 'utf8'
// app-kit's own scenarios — published as-is and seeded straight from here, so these files are
// both what app-kit runs and what a consumer receives.
const K6_TEMPLATES: ReadonlyArray<string> = ['k6/load-test.js', 'k6/stress-test.js']
// A scenario seeded before app-kit#109 — the exact shape an existing consumer carries.
const LEGACY_SCENARIO = `import { check } from 'k6'
import http from 'k6/http'

const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:4173'

export default function () {
	check(http.get(BASE_URL), { 'status is 200': (r) => r.status === 200 })
}
`
const TUNED_LINE = 'export const options = { vus: 50, duration: "5m" }'

describe('k6 scenario type-check directive (#109)', () => {
	it('prepends the directive to a scenario seeded before the fix', () => {
		const patched = k6_scenarios.ensure_ts_nocheck(LEGACY_SCENARIO)

		expect(patched.startsWith(k6_scenarios.TS_NOCHECK_DIRECTIVE)).toBe(true)
	})

	it('preserves the consumer tuned body verbatim', () => {
		// The scenario is the consumer's after the first sync; only the header app-kit owns is added.
		const patched = k6_scenarios.ensure_ts_nocheck(`${TUNED_LINE}\n`)

		expect(patched.endsWith(`${TUNED_LINE}\n`)).toBe(true)
	})

	it('explains why the directive is there, so it is not deleted as noise', () => {
		const patched = k6_scenarios.ensure_ts_nocheck(LEGACY_SCENARIO)

		expect(patched).toContain('@types/k6')
	})

	it('leaves a scenario that already declares the directive byte-identical', () => {
		const already = `${k6_scenarios.TS_NOCHECK_DIRECTIVE}\n${LEGACY_SCENARIO}`

		expect(k6_scenarios.ensure_ts_nocheck(already)).toBe(already)
	})

	it('is idempotent — a second pass adds nothing', () => {
		const once = k6_scenarios.ensure_ts_nocheck(LEGACY_SCENARIO)

		expect(k6_scenarios.ensure_ts_nocheck(once)).toBe(once)
	})

	it('still patches a file that only mentions the directive below the first statement', () => {
		// TypeScript honours the directive only ahead of the first statement, so a mention further
		// down leaves `tsc` failing — treating it as "already annotated" would report a false skip.
		const mentioned = `${LEGACY_SCENARIO}\n${k6_scenarios.TS_NOCHECK_DIRECTIVE} was removed here\n`

		const patched = k6_scenarios.ensure_ts_nocheck(mentioned)

		expect(patched.startsWith(k6_scenarios.TS_NOCHECK_HEADER)).toBe(true)
	})
})

describe('distributed k6 scenarios carry the directive', () => {
	// A freshly seeded scenario must compile in a consumer whose tsconfig type-checks `**/*.js`,
	// without the sync patch having to fire — otherwise `tsc --noEmit` breaks right after `init`.
	//
	// Asserting the whole header, not just the directive line, keeps the shipped templates and the
	// header the sync patch prepends from drifting: the wording lives in one place, and a seeded
	// scenario is byte-identical whichever path put the header there.
	it.each(K6_TEMPLATES)('%s opens with the header', (template) => {
		const source = readFileSync(template, ENCODING)

		expect(source.startsWith(k6_scenarios.TS_NOCHECK_HEADER)).toBe(true)
	})
})
