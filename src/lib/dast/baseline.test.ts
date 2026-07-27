import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { baseline } from './baseline.js'

const ENCODING = 'utf8'
// app-kit's own repo-root baseline — the single physical master both the consumer seed and the
// insert-if-absent merge derive from (app-kit#111). There is no templates/ copy.
const ROOT_CONF = 'zap-baseline.conf'
// Tier-2 rule ids: shipped commented-out, so the file mentions them but never as an active line.
const TIER_2_IDS: ReadonlyArray<string> = ['90003', '10017']

const MASTER = readFileSync(ROOT_CONF, ENCODING)
const SEED = baseline.distributable(MASTER)

function has_active_rule(content: string, id: string): boolean {
	return content.split('\n').some((line) => line.startsWith(`${id}\t`))
}

describe('distributable — the consumer-facing slice of the master', () => {
	it('strips the app-kit-only self-triage section', () => {
		expect(SEED).not.toContain(baseline.APP_KIT_ONLY_MARKER)
	})

	it('keeps every active Tier-1 rule line', () => {
		for (const line of baseline.active_rule_lines(MASTER)) {
			expect(SEED).toContain(line)
		}
	})

	it('keeps the Tier-2 rules commented, never active', () => {
		for (const id of TIER_2_IDS) {
			expect(SEED).toContain(`# ${id}\t`)
			expect(has_active_rule(SEED, id)).toBe(false)
		}
	})

	it('steers 10055 script-src widening toward the secure default', () => {
		expect(SEED).toContain('script-src widening')
		expect(SEED).toContain('per-request nonce')
	})

	it('returns a consumer file (no marker) unchanged', () => {
		const consumer = '2\tIGNORE\t(my own finding)\n'

		expect(baseline.distributable(consumer)).toBe(consumer)
	})
})

describe('active_rule_lines — only the distributable Tier-1 rules', () => {
	it('returns lines that all begin with a numeric rule id', () => {
		const lines = baseline.active_rule_lines(MASTER)

		expect(lines.length).toBeGreaterThan(0)

		for (const line of lines) {
			expect(line).toMatch(/^\d+\t/u)
		}
	})

	it('excludes the commented Tier-2 rules', () => {
		const ids = baseline.active_rule_lines(MASTER).map((line) => line.split('\t', 1)[0])

		for (const id of TIER_2_IDS) {
			expect(ids).not.toContain(id)
		}
	})
})

describe('ensure_baseline_rules — insert-if-absent merge from the master', () => {
	it('inserts every Tier-1 rule into a file that has none', () => {
		const patched = baseline.ensure_baseline_rules('', MASTER)

		for (const line of baseline.active_rule_lines(MASTER)) {
			expect(patched).toContain(line)
		}

		expect(patched).toContain(baseline.MERGE_MARKER)
	})

	it('never overwrites a rule the consumer already has an active line for', () => {
		const consumer = '10049\tWARN\t(consumer downgraded this deliberately)\n'

		const patched = baseline.ensure_baseline_rules(consumer, MASTER)

		expect(patched).toContain(consumer.trim())
		expect(patched.split('\n').filter((line) => line.startsWith('10049\t'))).toHaveLength(1)
	})

	it('respects a consumer who deliberately commented a Tier-1 rule out', () => {
		const patched = baseline.ensure_baseline_rules(
			'# 90004\tIGNORE\t(disabled on purpose)\n',
			MASTER,
		)

		expect(has_active_rule(patched, '90004')).toBe(false)
	})

	it('preserves a consumer Tier-3 rule verbatim while adding Tier-1', () => {
		const tier_3 = '2\tIGNORE\t(Private IP false positive: SVG path data in a bundled icon)'

		const patched = baseline.ensure_baseline_rules(`${tier_3}\n`, MASTER)

		expect(patched).toContain(tier_3)
		expect(has_active_rule(patched, '90004')).toBe(true)
	})

	it('is idempotent — a second pass over an already-merged file changes nothing', () => {
		const once = baseline.ensure_baseline_rules('# consumer header\n', MASTER)

		expect(baseline.ensure_baseline_rules(once, MASTER)).toBe(once)
	})
})

describe('the master keeps its app-kit-only section', () => {
	it('the repo-root file carries the app-kit-only delimiter', () => {
		expect(MASTER).toContain(baseline.APP_KIT_ONLY_MARKER)
	})
})
