import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { baseline } from '#dast/baseline.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { k6_scenarios } from './k6-scenarios.js'
import { cloudflare_sync } from './sync.js'

const ENCODING = 'utf8'
// app-kit's repo root: holds the canonical package.json plus every overlay source (templates/, k6/).
const SOURCE_DIR = '.'
const PACKAGE_JSON = 'package.json'
const FIXTURE_NAME = 'fixture'

// Single-sourced (#156): the distributed master IS the workflow app-kit runs, so the same path
// serves as both the overlay source and the comparison baseline below.
const DAST_WORKFLOW = '.github/workflows/dast.yml'
const LOAD_WORKFLOW = '.github/workflows/load.yml'
// Single-sourced: app-kit's own scenarios are what `josh-app sync` seeds, so there is no separate
// template path to compare against.
const K6_DIRECTORY = 'k6/'
const K6_SCENARIO = 'k6/load-test.js'
const K6_STRESS = 'k6/stress-test.js'
const CI_WORKFLOW = '.github/workflows/ci.yml'
const ZAP_CONF = 'zap-baseline.conf'
const HEADERS_FILE = '_headers'
const HEADERS_TEMPLATE = 'templates/_headers'
const TEMPLATES_DIR = 'templates'
const SECURITY_E2E_FILE = 'src/routes/security-headers.e2e.ts'
const SECURITY_E2E_TEMPLATE = `${TEMPLATES_DIR}/security-headers-e2e.ts`
// The two import specifiers for one module: consumers resolve the published subpath, app-kit
// resolves its own source through $lib. Normalizing one to the other is what lets the template and
// the copy app-kit actually runs be compared byte for byte.
const CONSUMER_IMPORT = '@joshuafolkken/app-kit/security/e2e'
const APP_KIT_IMPORT = '$lib/security/e2e.js'
const SECURITY_E2E_SUBPATH = './security/e2e'

// Literals shared by the DAST and load-test cases (both are managed workflow copies), extracted so
// the duplicate-string rule stays quiet and a wording change lands in one place.
const EDITED_LOCALLY = 'name: Edited locally\n'
// A scenario the consumer has calibrated — stands in for any post-seed customization.
const TUNED_SCENARIO = 'export const options = { vus: 50, duration: "5m" }\n'
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

/** A source file with its import block dropped — everything the two copies of a spec must share. */
function body_of(file: string): string {
	return readFileSync(file, ENCODING)
		.split('\n')
		.filter((line) => !line.startsWith('import '))
		.join('\n')
}

function action_for(file: string): string | undefined {
	const changes = cloudflare_sync.apply_overlay(state.directory, SOURCE_DIR)

	return changes.find((change) => change.file === file)?.action
}

// What a consumer's copy of an app-kit-managed workflow must be: whatever `managed_copy_content`
// decides for that destination (#192). Asking the seam rather than re-deriving the stamp here is
// what keeps this assertion about apply_overlay's routing; the stamp's own content is pinned
// against app-kit's real package name in workflow-stamp.test.ts.
function distributed(file: string): string {
	return cloudflare_sync.managed_copy_content(
		{ template: file, dest: file },
		fixture_path(file),
		SOURCE_DIR,
	)
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
		expect(read_fixture(DAST_WORKFLOW)).toBe(distributed(DAST_WORKFLOW))
	})

	it('overwrites a drifted workflow so mechanics fixes reach consumers', () => {
		cloudflare_sync.apply_overlay(state.directory, SOURCE_DIR)
		writeFileSync(fixture_path(DAST_WORKFLOW), EDITED_LOCALLY)

		expect(action_for(DAST_WORKFLOW)).toBe('updated')
		expect(read_fixture(DAST_WORKFLOW)).toBe(distributed(DAST_WORKFLOW))
	})

	// #192 gave this a second job. The overlay now compares the STAMPED content against disk; had it
	// kept comparing the raw template, every sync would rewrite the file and — kit's helper refusing
	// to stamp an already-stamped one — report `updated` forever.
	it('reports an already-current workflow as skipped rather than a phantom update', () => {
		cloudflare_sync.apply_overlay(state.directory, SOURCE_DIR)
		const after_first = read_fixture(DAST_WORKFLOW)

		expect(action_for(DAST_WORKFLOW)).toBe('skipped')
		expect(read_fixture(DAST_WORKFLOW)).toBe(after_first)
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
		expect(read_fixture(LOAD_WORKFLOW)).toBe(distributed(LOAD_WORKFLOW))
	})

	it('overwrites a drifted load.yml so mechanics fixes reach consumers', () => {
		cloudflare_sync.apply_overlay(state.directory, SOURCE_DIR)
		writeFileSync(fixture_path(LOAD_WORKFLOW), EDITED_LOCALLY)

		expect(action_for(LOAD_WORKFLOW)).toBe('updated')
		expect(read_fixture(LOAD_WORKFLOW)).toBe(distributed(LOAD_WORKFLOW))
	})

	it('reports an already-current load.yml as skipped, not a phantom update', () => {
		cloudflare_sync.apply_overlay(state.directory, SOURCE_DIR)

		expect(action_for(LOAD_WORKFLOW)).toBe('skipped')
	})
})

describe('k6 load-test scenario seeding', () => {
	it('seeds the baseline scenario when the project has none', () => {
		expect(action_for(K6_SCENARIO)).toBe('created')
		expect(read_fixture(K6_SCENARIO)).toBe(readFileSync(K6_SCENARIO, ENCODING))
	})

	it('seeds the stress scenario when the project has none', () => {
		expect(action_for(K6_STRESS)).toBe('created')
		expect(read_fixture(K6_STRESS)).toBe(readFileSync(K6_STRESS, ENCODING))
	})

	it('never overwrites a tuned scenario on a re-sync', () => {
		// VUs, duration, and exercised endpoints are the consumer's to tune; clobbering them on
		// sync would silently reset a calibrated load profile.
		cloudflare_sync.apply_overlay(state.directory, SOURCE_DIR)
		writeFileSync(fixture_path(K6_SCENARIO), TUNED_SCENARIO)
		cloudflare_sync.apply_overlay(state.directory, SOURCE_DIR)

		// Exact match, not `toContain`: proves the header is all that was added — the tuned body is
		// neither rewritten nor duplicated.
		expect(read_fixture(K6_SCENARIO)).toBe(`${k6_scenarios.TS_NOCHECK_HEADER}${TUNED_SCENARIO}`)
	})

	it('reports a freshly seeded scenario as created, not patched', () => {
		// The seeded source already carries the directive, so the seed needs no follow-up edit — and
		// the per-file summary stays one honest line.
		expect(action_for(K6_SCENARIO)).toBe('created')
		expect(action_for(K6_SCENARIO)).toBe('skipped')
	})
})

describe('k6 scenario type-check directive reaches seeded projects (#109)', () => {
	// The scenarios are seeded once, so a template-only fix would never land in a project that
	// already synced — it would keep failing `tsc --noEmit` until hand-fixed.
	it.each([K6_SCENARIO, K6_STRESS])('adds the directive to a pre-existing %s', (scenario) => {
		cloudflare_sync.apply_overlay(state.directory, SOURCE_DIR)
		writeFileSync(fixture_path(scenario), TUNED_SCENARIO)

		expect(action_for(scenario)).toBe('updated')
		expect(read_fixture(scenario)).toContain(k6_scenarios.TS_NOCHECK_DIRECTIVE)
	})

	it('patches only the scenarios — every other seeded file stays the consumer own', () => {
		// A seed entry without a `patch` is untouched forever; app.html / wrangler.jsonc / _headers
		// carry project-specific content app-kit has no line to keep correct in. (zap-baseline.conf
		// is single-sourced through its own sync_zap_baseline step, not a SEED_ENTRY.)
		const patched = cloudflare_sync.SEED_ENTRIES.filter((entry) => entry.patch !== undefined)

		expect(patched.map((entry) => entry.dest)).toEqual([K6_SCENARIO, K6_STRESS])
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
		expect(trigger_block_of(LOAD_WORKFLOW)).toContain(WORKFLOW_DISPATCH)
	})

	it('ships the schedule commented out — an opt-in, not the default', () => {
		const lines = trigger_block_of(LOAD_WORKFLOW).split('\n')

		// The schedule exists only as guidance behind a `#`, never an active trigger line like
		// dast.yml's — so no bare (untrimmed-to-`schedule:`) line appears.
		expect(lines.some((line) => line.includes('# schedule:'))).toBe(true)
		expect(lines.some((line) => line.trimStart().startsWith('schedule:'))).toBe(false)
	})

	it('does not run on push or pull_request', () => {
		expect(trigger_block_of(LOAD_WORKFLOW)).not.toContain(PUSH_TRIGGER)
		expect(trigger_block_of(LOAD_WORKFLOW)).not.toContain(PULL_REQUEST_TRIGGER)
	})
})

describe('ZAP baseline config seeding', () => {
	it('seeds the distributable slice of the master when the project has none', () => {
		const seed = baseline.distributable(readFileSync(ZAP_CONF, ENCODING))

		expect(action_for(ZAP_CONF)).toBe('created')
		expect(read_fixture(ZAP_CONF)).toBe(seed)
	})

	it('never overwrites recorded triage decisions on a re-sync', () => {
		// Re-opening a deliberately baselined finding — and discarding the recorded reason —
		// would be a silent security regression. The Tier-1 merge is insert-only, so a consumer's
		// own decision survives verbatim even as the universal baseline is added around it (#111).
		const triaged = '10038\tIGNORE\t(CSP is set at the CDN edge)\n'

		cloudflare_sync.apply_overlay(state.directory, SOURCE_DIR)
		writeFileSync(fixture_path(ZAP_CONF), triaged)
		cloudflare_sync.apply_overlay(state.directory, SOURCE_DIR)

		expect(read_fixture(ZAP_CONF)).toContain(triaged.trimEnd())
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

// app-kit#120: README and dast.yml both justified the nightly-only ZAP scan by pointing at "the
// Docker-free E2E assertions in security-headers.e2e.ts" — a file app-kit shipped nowhere. Until
// this entry existed the documented per-PR net simply did not reach a consumer, and each one wrote
// its own copy (joshuafolkken-com#790 wrote the third).
describe('security-headers E2E distribution (#120)', () => {
	it('seeds the spec under src/routes, where the E2E suite collects it', () => {
		expect(action_for(SECURITY_E2E_FILE)).toBe('created')
		expect(read_fixture(SECURITY_E2E_FILE)).toBe(readFileSync(SECURITY_E2E_TEMPLATE, ENCODING))
	})

	it('never overwrites the instance-specific cases a consumer added', () => {
		// The seeded spec is a starting point the consumer extends with their own allowlisted
		// origins and embed routes; a byte-copy on every sync would erase that work.
		const extended = "import { test } from '@playwright/test'\n// our own CSP cases\n"

		cloudflare_sync.apply_overlay(state.directory, SOURCE_DIR)
		writeFileSync(fixture_path(SECURITY_E2E_FILE), extended)

		expect(action_for(SECURITY_E2E_FILE)).toBe('skipped')
		expect(read_fixture(SECURITY_E2E_FILE)).toBe(extended)
	})

	it('seeds a spec that imports the assertions from the published subpath', () => {
		// A relative or $lib import would resolve to nothing in a consumer, so the seeded file has to
		// name the subpath — and that subpath has to be one package.json actually exports.
		const manifest = JSON.parse(readFileSync(PACKAGE_JSON, ENCODING)) as {
			exports: Record<string, unknown>
		}

		expect(readFileSync(SECURITY_E2E_TEMPLATE, ENCODING)).toContain(CONSUMER_IMPORT)
		expect(Object.keys(manifest.exports)).toContain(SECURITY_E2E_SUBPATH)
	})

	// "app-kit distributes what it runs": the spec app-kit's own CI executes against its own preview
	// is the spec consumers receive. Only the import block may differ — app-kit resolves the module
	// through $lib, a consumer through the published subpath, and the sort plugin orders the two
	// specifiers differently — so the comparison drops imports and holds the body byte for byte. A
	// guard rather than a convention, because a fix applied to one copy is invisible until it matters.
	it('runs the very spec it seeds, import block aside', () => {
		expect(body_of(SECURITY_E2E_FILE)).toBe(body_of(SECURITY_E2E_TEMPLATE))
	})

	it('resolves the same assertions from both sides of the distribution boundary', () => {
		expect(readFileSync(SECURITY_E2E_FILE, ENCODING)).toContain(APP_KIT_IMPORT)
		expect(readFileSync(SECURITY_E2E_TEMPLATE, ENCODING)).toContain(CONSUMER_IMPORT)
	})

	// The template must NOT be named `*.e2e.ts`: playwright.config.ts is kit-distributed and collects
	// `**/*.e2e.{ts,js}` from the repo root with no testIgnore, so a template with that suffix would
	// join app-kit's own suite and fail on its unresolvable `@joshuafolkken/app-kit/...` self-import.
	it('keeps every template out of the Playwright test glob', () => {
		const collected = readdirSync(TEMPLATES_DIR, { recursive: true, encoding: ENCODING }).filter(
			(entry) => entry.endsWith('.e2e.ts') || entry.endsWith('.e2e.js'),
		)

		expect(collected).toEqual([])
	})
})

describe('DAST workflow runs on a schedule, not per-PR (#103)', () => {
	// The ~2.2GB ZAP image is re-pulled every ephemeral run, so the full scan runs nightly (broad
	// safety net) rather than on every PR — per-PR header coverage lives in security-headers.e2e.ts.
	it('triggers on a schedule and manual dispatch', () => {
		const source = readFileSync(DAST_WORKFLOW, ENCODING)

		expect(source).toMatch(/^on:\n\s+schedule:\n\s+- cron:/mu)
		expect(source).toContain(WORKFLOW_DISPATCH)
	})

	it('does not run on push or pull_request (that would re-pull 2GB per PR)', () => {
		const block = trigger_block_of(DAST_WORKFLOW)

		expect(block).not.toContain(PUSH_TRIGGER)
		expect(block).not.toContain(PULL_REQUEST_TRIGGER)
	})
})

describe('app-kit distributes what it runs', () => {
	it('distributes the workflows from the very files it runs, with no second copy to drift', () => {
		// A templates/workflows mirror kept "identical" only by a byte-comparison test is exactly
		// what Dependabot broke on every action bump: its github-actions ecosystem scans only
		// .github/workflows/**, so the runtime copy moved and the template stayed behind (#156).
		// Source === destination makes the guarantee structural, like the k6 scenarios below.
		const workflow_entries = cloudflare_sync.MANAGED_COPY_ENTRIES

		expect(workflow_entries.map((entry) => entry.template)).toEqual([DAST_WORKFLOW, LOAD_WORKFLOW])
		expect(workflow_entries.every((entry) => entry.template === entry.dest)).toBe(true)
	})

	it('seeds the k6 scenarios from the very files it runs, with no second copy to drift', () => {
		// app-kit runs `josh-app load` on k6/*.js and distributes those same paths, so source and
		// destination coincide. A templates/k6 duplicate would need a mirror test to stay honest;
		// single-sourcing makes the guarantee structural.
		const k6_entries = cloudflare_sync.SEED_ENTRIES.filter((entry) =>
			entry.dest.startsWith(K6_DIRECTORY),
		)

		expect(k6_entries.map((entry) => entry.template)).toEqual([K6_SCENARIO, K6_STRESS])
		expect(k6_entries.every((entry) => entry.template === entry.dest)).toBe(true)
	})

	it('ships every file the overlay copies', () => {
		// `template` is a package-root-relative path, so this also proves each one is inside a
		// directory package.json `files` publishes — see the manifest contract test.
		for (const entry of [
			...cloudflare_sync.MANAGED_COPY_ENTRIES,
			...cloudflare_sync.SEED_ENTRIES,
		]) {
			expect(existsSync(entry.template), entry.template).toBe(true)
		}
	})
})
