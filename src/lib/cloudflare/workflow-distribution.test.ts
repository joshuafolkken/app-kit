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
const CI_WORKFLOW = '.github/workflows/ci.yml'
const ZAP_CONF = 'zap-baseline.conf'
const ZAP_CONF_TEMPLATE = 'templates/zap-baseline.conf'
const HEADERS_FILE = '_headers'
const HEADERS_TEMPLATE = 'templates/_headers'

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
		writeFileSync(fixture_path(DAST_WORKFLOW), 'name: Edited locally\n')

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
		expect(source).toContain('workflow_dispatch:')
	})

	it('does not run on push or pull_request (that would re-pull 2GB per PR)', () => {
		const source = readFileSync(DAST_TEMPLATE, ENCODING)
		const trigger_block = source.split('\non:\n', 2)[1]?.split('\nconcurrency:', 2)[0] ?? ''

		expect(trigger_block).not.toContain('push:')
		expect(trigger_block).not.toContain('pull_request:')
	})
})

describe('app-kit distributes what it runs', () => {
	it('keeps its own DAST workflow identical to the distributed template', () => {
		// Drift here means app-kit's CI would be testing a workflow no consumer receives.
		expect(readFileSync(DAST_WORKFLOW, ENCODING)).toBe(readFileSync(DAST_TEMPLATE, ENCODING))
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
