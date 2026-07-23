import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cloudflare_sync } from './sync.js'

const ENCODING = 'utf8'
// app-kit's repo root: holds the canonical package.json + templates/.
const SOURCE_DIR = '.'
const PACKAGE_JSON = 'package.json'
const FIXTURE_NAME = 'fixture'

const DAST_WORKFLOW = '.github/workflows/dast.yml'
const DAST_TEMPLATE = 'templates/workflows/dast.yml'
const LOAD_WORKFLOW = '.github/workflows/load.yml'
const LOAD_TEMPLATE = 'templates/workflows/load.yml'
const K6_SCENARIO = 'k6/load-test.js'
const K6_SCENARIO_TEMPLATE = 'templates/k6/load-test.js'
const K6_STRESS = 'k6/stress-test.js'
const K6_STRESS_TEMPLATE = 'templates/k6/stress-test.js'
const CI_WORKFLOW = '.github/workflows/ci.yml'
const ZAP_CONF = 'zap-baseline.conf'
const ZAP_CONF_TEMPLATE = 'templates/zap-baseline.conf'
const HEADERS_FILE = '_headers'
const HEADERS_TEMPLATE = 'templates/_headers'

// Literals shared by the DAST and load-test cases (both are managed workflow copies), extracted so
// the duplicate-string rule stays quiet and a wording change lands in one place.
const EDITED_LOCALLY = 'name: Edited locally\n'
const WORKFLOW_DISPATCH = 'workflow_dispatch:'
const PUSH_TRIGGER = 'push:'
const PULL_REQUEST_TRIGGER = 'pull_request:'

const state = { directory: '' }

function fixture_path(relative_path: string): string {
	return path.join(state.directory, relative_path)
}

function read_fixture(relative_path: string): string {
	return readFileSync(fixture_path(relative_path), ENCODING)
}

function action_for(file: string): string | undefined {
	const changes = cloudflare_sync.apply_overlay(state.directory, SOURCE_DIR)

	return changes.find((change) => change.file === file)?.action
}

beforeEach(() => {
	state.directory = mkdtempSync(path.join(tmpdir(), 'app-kit-dast-'))
	const manifest = { name: FIXTURE_NAME, scripts: {} }

	writeFileSync(fixture_path(PACKAGE_JSON), `${JSON.stringify(manifest, undefined, '\t')}\n`)
})

afterEach(() => {
	rmSync(state.directory, { recursive: true, force: true })
})

describe('DAST workflow distribution', () => {
	it('creates the workflow, including its directory, in a project that has none', () => {
		expect(action_for(DAST_WORKFLOW)).toBe('created')
		expect(read_fixture(DAST_WORKFLOW)).toBe(readFileSync(DAST_TEMPLATE, ENCODING))
	})

	it('overwrites a drifted workflow so mechanics fixes reach consumers', () => {
		cloudflare_sync.apply_overlay(state.directory, SOURCE_DIR)
		writeFileSync(fixture_path(DAST_WORKFLOW), EDITED_LOCALLY)

		expect(action_for(DAST_WORKFLOW)).toBe('updated')
		expect(read_fixture(DAST_WORKFLOW)).toBe(readFileSync(DAST_TEMPLATE, ENCODING))
	})

	it('reports an already-current workflow as skipped rather than a phantom update', () => {
		cloudflare_sync.apply_overlay(state.directory, SOURCE_DIR)

		expect(action_for(DAST_WORKFLOW)).toBe('skipped')
	})

	it('never writes ci.yml, which kit single-sources', () => {
		// Two packages mastering one path would make the winner depend on sync order, silently
		// losing one side's content. app-kit is strictly additive here.
		cloudflare_sync.apply_overlay(state.directory, SOURCE_DIR)

		expect(existsSync(fixture_path(CI_WORKFLOW))).toBe(false)

		for (const entry of cloudflare_sync.MANAGED_COPY_ENTRIES) {
			expect(entry.dest).not.toBe(CI_WORKFLOW)
		}
	})

	it('leaves a consumer-authored ci.yml untouched', () => {
		const original = 'name: Consumer CI\n'

		cloudflare_sync.apply_overlay(state.directory, SOURCE_DIR)
		writeFileSync(fixture_path(CI_WORKFLOW), original)
		cloudflare_sync.apply_overlay(state.directory, SOURCE_DIR)

		expect(read_fixture(CI_WORKFLOW)).toBe(original)
	})
})

describe('Load-test workflow distribution', () => {
	it('creates load.yml, including its directory, in a project that has none', () => {
		expect(action_for(LOAD_WORKFLOW)).toBe('created')
		expect(read_fixture(LOAD_WORKFLOW)).toBe(readFileSync(LOAD_TEMPLATE, ENCODING))
	})

	it('overwrites a drifted load.yml so mechanics fixes reach consumers', () => {
		cloudflare_sync.apply_overlay(state.directory, SOURCE_DIR)
		writeFileSync(fixture_path(LOAD_WORKFLOW), EDITED_LOCALLY)

		expect(action_for(LOAD_WORKFLOW)).toBe('updated')
		expect(read_fixture(LOAD_WORKFLOW)).toBe(readFileSync(LOAD_TEMPLATE, ENCODING))
	})

	it('reports an already-current load.yml as skipped, not a phantom update', () => {
		cloudflare_sync.apply_overlay(state.directory, SOURCE_DIR)

		expect(action_for(LOAD_WORKFLOW)).toBe('skipped')
	})
})

describe('k6 load-test scenario seeding', () => {
	it('seeds the baseline scenario when the project has none', () => {
		expect(action_for(K6_SCENARIO)).toBe('created')
		expect(read_fixture(K6_SCENARIO)).toBe(readFileSync(K6_SCENARIO_TEMPLATE, ENCODING))
	})

	it('seeds the stress scenario when the project has none', () => {
		expect(action_for(K6_STRESS)).toBe('created')
		expect(read_fixture(K6_STRESS)).toBe(readFileSync(K6_STRESS_TEMPLATE, ENCODING))
	})

	it('never overwrites a tuned scenario on a re-sync', () => {
		// VUs, duration, and exercised endpoints are the consumer's to tune; clobbering them on
		// sync would silently reset a calibrated load profile.
		const tuned = 'export const options = { vus: 50, duration: "5m" }\n'

		cloudflare_sync.apply_overlay(state.directory, SOURCE_DIR)
		writeFileSync(fixture_path(K6_SCENARIO), tuned)

		expect(action_for(K6_SCENARIO)).toBe('skipped')
		expect(read_fixture(K6_SCENARIO)).toBe(tuned)
	})
})

// The `on:` trigger block of a workflow template — the text between `on:` and `concurrency:`.
function trigger_block_of(template: string): string {
	const source = readFileSync(template, ENCODING)

	return source.split('\non:\n', 2)[1]?.split('\nconcurrency:', 2)[0] ?? ''
}

describe('Load-test workflow runs manually, not per-PR or on a schedule (#95)', () => {
	// A load test reports numbers that need a baseline to interpret, and noisy CI runners make an
	// uncalibrated scheduled run decay into noise, so the distributed default is manual dispatch.
	it('triggers on manual dispatch', () => {
		expect(trigger_block_of(LOAD_TEMPLATE)).toContain(WORKFLOW_DISPATCH)
	})

	it('ships the schedule commented out — an opt-in, not the default', () => {
		const lines = trigger_block_of(LOAD_TEMPLATE).split('\n')

		// The schedule exists only as guidance behind a `#`, never an active trigger line like
		// dast.yml's — so no bare (untrimmed-to-`schedule:`) line appears.
		expect(lines.some((line) => line.includes('# schedule:'))).toBe(true)
		expect(lines.some((line) => line.trimStart().startsWith('schedule:'))).toBe(false)
	})

	it('does not run on push or pull_request', () => {
		expect(trigger_block_of(LOAD_TEMPLATE)).not.toContain(PUSH_TRIGGER)
		expect(trigger_block_of(LOAD_TEMPLATE)).not.toContain(PULL_REQUEST_TRIGGER)
	})
})

describe('ZAP baseline config seeding', () => {
	it('seeds the triage config when the project has none', () => {
		expect(action_for(ZAP_CONF)).toBe('created')
		expect(read_fixture(ZAP_CONF)).toBe(readFileSync(ZAP_CONF_TEMPLATE, ENCODING))
	})

	it('never overwrites recorded triage decisions on a re-sync', () => {
		// Re-opening a deliberately baselined finding — and discarding the recorded reason —
		// would be a silent security regression.
		const triaged = '10038\tIGNORE\t(CSP is set at the CDN edge)\n'

		cloudflare_sync.apply_overlay(state.directory, SOURCE_DIR)
		writeFileSync(fixture_path(ZAP_CONF), triaged)

		expect(action_for(ZAP_CONF)).toBe('skipped')
		expect(read_fixture(ZAP_CONF)).toBe(triaged)
	})
})

describe('security headers seeding', () => {
	it('seeds _headers at the project root, where adapter-cloudflare requires it', () => {
		// A static/_headers makes adapter-cloudflare throw at build time, so the destination
		// matters as much as the content.
		expect(action_for(HEADERS_FILE)).toBe('created')
		expect(read_fixture(HEADERS_FILE)).toBe(readFileSync(HEADERS_TEMPLATE, ENCODING))
	})

	it('never overwrites a project header policy on a re-sync', () => {
		// CSP, CORS, and cache rules are project-specific; clobbering them on sync could take a
		// production security policy with it.
		const owned = '/*\n  Content-Security-Policy: default-src self\n'

		cloudflare_sync.apply_overlay(state.directory, SOURCE_DIR)
		writeFileSync(fixture_path(HEADERS_FILE), owned)

		expect(action_for(HEADERS_FILE)).toBe('skipped')
		expect(read_fixture(HEADERS_FILE)).toBe(owned)
	})
})

describe('DAST workflow runs on a schedule, not per-PR (#103)', () => {
	// The ~2.2GB ZAP image is re-pulled every ephemeral run, so the full scan runs nightly (broad
	// safety net) rather than on every PR — per-PR header coverage lives in security-headers.e2e.ts.
	it('triggers on a schedule and manual dispatch', () => {
		const source = readFileSync(DAST_TEMPLATE, ENCODING)

		expect(source).toMatch(/^on:\n\s+schedule:\n\s+- cron:/mu)
		expect(source).toContain(WORKFLOW_DISPATCH)
	})

	it('does not run on push or pull_request (that would re-pull 2GB per PR)', () => {
		const block = trigger_block_of(DAST_TEMPLATE)

		expect(block).not.toContain(PUSH_TRIGGER)
		expect(block).not.toContain(PULL_REQUEST_TRIGGER)
	})
})

describe('app-kit distributes what it runs', () => {
	it('keeps its own DAST workflow identical to the distributed template', () => {
		// Drift here means app-kit's CI would be testing a workflow no consumer receives.
		expect(readFileSync(DAST_WORKFLOW, ENCODING)).toBe(readFileSync(DAST_TEMPLATE, ENCODING))
	})

	it('keeps its own load-test workflow identical to the distributed template', () => {
		expect(readFileSync(LOAD_WORKFLOW, ENCODING)).toBe(readFileSync(LOAD_TEMPLATE, ENCODING))
	})

	it('keeps its own k6 scenarios identical to the distributed templates', () => {
		// app-kit runs `josh-app load` on its own seeded scenarios, so its copies must match the
		// templates consumers receive — otherwise app-kit tests a scenario no one else has.
		expect(readFileSync(K6_SCENARIO, ENCODING)).toBe(readFileSync(K6_SCENARIO_TEMPLATE, ENCODING))
		expect(readFileSync(K6_STRESS, ENCODING)).toBe(readFileSync(K6_STRESS_TEMPLATE, ENCODING))
	})

	it('ships the templates the overlay copies', () => {
		for (const entry of [
			...cloudflare_sync.MANAGED_COPY_ENTRIES,
			...cloudflare_sync.SEED_ENTRIES,
		]) {
			expect(existsSync(path.join('templates', entry.template))).toBe(true)
		}
	})
})
