import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { managed_scripts } from './managed-scripts.js'
import { sync_fixture } from './sync-fixture.js'
import { cloudflare_sync } from './sync.js'

const {
	ENCODING,
	SOURCE_DIR,
	PACKAGE_JSON,
	ESLINT_FILE,
	WRANGLER_JSONC,
	WRANGLER_TEMPLATE,
	VSCODE_SETTINGS,
	VSCODE_TEMPLATE,
	DEV_KEY,
	STALE_DEV_VALUE,
	CONSUMER_KEY,
	CONSUMER_VALUE,
	CONSUMER_ESLINT_CONTENT,
} = sync_fixture

const APP_HTML = 'src/app.html'
const APP_D_TS = 'src/app.d.ts'
// kit's `josh init` vanilla scaffold — the overlay migrates it to the app-kit sveltekit preset.
const KIT_VANILLA_ESLINT_CONTENT = `import { create_vanilla_config } from '@joshuafolkken/kit/eslint/vanilla'

export default create_vanilla_config({
	gitignore_path: new URL('./.gitignore', import.meta.url),
	tsconfig_root_dir: import.meta.dirname,
})
`
const APP_KIT_ESLINT_MODULE = '@joshuafolkken/app-kit/eslint/sveltekit'
const CSPELL_FILE = 'cspell.config.yaml'
const TSCONFIG_FILE = 'tsconfig.json'
const KIT_CSPELL = '@joshuafolkken/kit/cspell/sveltekit'
const APP_KIT_CSPELL = '@joshuafolkken/app-kit/cspell/sveltekit'
const FAST_CHECK_PACKAGE = 'svelte-fast-check'

beforeEach(() => {
	sync_fixture.create()
})

afterEach(() => {
	sync_fixture.remove()
})

// #183 (kit#825): the overlay must hand consumers the pnpm-free port wiring. Inside
// `$(pnpm josh port …)` pnpm's own stdout — `[ELIFECYCLE] …` on a bad PORT_SEED, install logs when
// node_modules is stale — becomes the port argument, and an inline substitution's failure never
// stops the command it is spliced into. The assignment form fixes both, so a consumer's synced
// `preview` must carry it, byte-identical to app-kit's canonical script.
describe('cloudflare sync port wiring', () => {
	it('writes the consumer preview with the pnpm-free assignment-form port wiring', () => {
		cloudflare_sync.apply_overlay(sync_fixture.directory(), SOURCE_DIR)

		const { preview } = sync_fixture.scripts()

		expect(preview).toBe(managed_scripts.read_canonical_scripts(PACKAGE_JSON).preview)
		expect(preview?.startsWith('PREVIEW_PORT=$(josh port preview) && ')).toBe(true)
		expect(preview).not.toContain('$(pnpm')
	})

	// #188: only `preview` carried the wiring, so `dev` stayed on whatever the consumer scaffolded
	// and no sync could repair it — the half of the pair Playwright runs on its LOCAL branch. The
	// fixture starts from that pre-#188 shape, so this fails on a `dev` the overlay left alone.
	// What the canonical `dev` must itself look like is managed-scripts.test.ts's contract; asserting
	// its shape again here would duplicate that guard and drift from it. This owns the other half:
	// that the overlay REPLACES a stale value rather than preserving it, which is what makes a
	// project scaffolded before #188 repairable.
	it('repairs a stale bare `vite dev` into the canonical port-wired dev script', () => {
		expect(sync_fixture.scripts()[DEV_KEY]).toBe(STALE_DEV_VALUE)

		cloudflare_sync.apply_overlay(sync_fixture.directory(), SOURCE_DIR)

		const canonical = managed_scripts.read_canonical_scripts(PACKAGE_JSON)

		expect(sync_fixture.scripts()[DEV_KEY]).toBe(canonical.dev)
	})
})

describe('cloudflare sync overlay', () => {
	it('adds the managed scripts, app-shell templates, and seeds wrangler.jsonc', () => {
		cloudflare_sync.apply_overlay(sync_fixture.directory(), SOURCE_DIR)

		const scripts = sync_fixture.scripts()

		for (const key of managed_scripts.MANAGED_SCRIPT_KEYS) {
			expect(scripts[key], key).toBeTypeOf('string')
		}

		expect(sync_fixture.read(APP_HTML)).toBe(readFileSync('templates/app.html', ENCODING))
		expect(sync_fixture.read(WRANGLER_JSONC)).toBe(readFileSync(WRANGLER_TEMPLATE, ENCODING))
		expect(sync_fixture.read(VSCODE_SETTINGS)).toBe(readFileSync(VSCODE_TEMPLATE, ENCODING))
	})

	it('preserves the consumer non-managed scripts and a consumer-customized eslint config', () => {
		cloudflare_sync.apply_overlay(sync_fixture.directory(), SOURCE_DIR)

		expect(sync_fixture.scripts()[CONSUMER_KEY]).toBe(CONSUMER_VALUE)
		expect(sync_fixture.read(ESLINT_FILE)).toBe(CONSUMER_ESLINT_CONTENT)
	})

	it('migrates a kit vanilla eslint.config.js to the app-kit sveltekit preset', () => {
		writeFileSync(sync_fixture.path_of(ESLINT_FILE), KIT_VANILLA_ESLINT_CONTENT)

		cloudflare_sync.apply_overlay(sync_fixture.directory(), SOURCE_DIR)

		expect(sync_fixture.read(ESLINT_FILE)).toContain(APP_KIT_ESLINT_MODULE)
		expect(sync_fixture.read(ESLINT_FILE)).not.toContain('@joshuafolkken/kit/eslint/vanilla')
	})

	it('is idempotent — a second overlay leaves package.json byte-identical', () => {
		cloudflare_sync.apply_overlay(sync_fixture.directory(), SOURCE_DIR)
		const after_first = sync_fixture.read(PACKAGE_JSON)

		cloudflare_sync.apply_overlay(sync_fixture.directory(), SOURCE_DIR)

		expect(sync_fixture.read(PACKAGE_JSON)).toBe(after_first)
	})

	it('does not rewrite an app-shell template whose content is unchanged', () => {
		cloudflare_sync.apply_overlay(sync_fixture.directory(), SOURCE_DIR)
		const before = statSync(sync_fixture.path_of(APP_HTML)).mtimeMs

		cloudflare_sync.apply_overlay(sync_fixture.directory(), SOURCE_DIR)

		expect(statSync(sync_fixture.path_of(APP_HTML)).mtimeMs).toBe(before)
	})
})

describe('cloudflare sync overlay — svelte-fast-check devDependency (#78)', () => {
	it('seeds svelte-fast-check into consumer devDependencies when absent', () => {
		cloudflare_sync.apply_overlay(sync_fixture.directory(), SOURCE_DIR)

		const source_range = (
			JSON.parse(readFileSync(PACKAGE_JSON, ENCODING)) as {
				devDependencies: Record<string, string>
			}
		).devDependencies[FAST_CHECK_PACKAGE]

		expect(sync_fixture.development_dependencies()[FAST_CHECK_PACKAGE]).toBe(source_range)
	})

	it('leaves an existing consumer svelte-fast-check pin untouched', () => {
		const pinned = '0.0.1'

		sync_fixture.write_manifest({ [FAST_CHECK_PACKAGE]: pinned })

		cloudflare_sync.apply_overlay(sync_fixture.directory(), SOURCE_DIR)

		expect(sync_fixture.development_dependencies()[FAST_CHECK_PACKAGE]).toBe(pinned)
	})

	it('appends the seed while preserving the consumer existing key order', () => {
		sync_fixture.write_manifest({ vitest: '^4.0.0', eslint: '^10.0.0' })

		cloudflare_sync.apply_overlay(sync_fixture.directory(), SOURCE_DIR)

		// no re-sort: the consumer's ordering is untouched and the seed lands at the end,
		// so the sync diff stays a one-line change instead of reshuffling every entry
		expect(Object.keys(sync_fixture.development_dependencies())).toEqual([
			'vitest',
			'eslint',
			FAST_CHECK_PACKAGE,
		])
	})
})

describe('cloudflare sync overlay — non-destructive & summary', () => {
	it('does not overwrite an already-customized app.html / app.d.ts', () => {
		const custom_html = '<!doctype html><html lang="%lang%"><!-- analytics --></html>\n'
		const custom_dts = '// custom env types\nexport {}\n'

		mkdirSync(sync_fixture.path_of('src'), { recursive: true })
		writeFileSync(sync_fixture.path_of(APP_HTML), custom_html)
		writeFileSync(sync_fixture.path_of(APP_D_TS), custom_dts)
		cloudflare_sync.apply_overlay(sync_fixture.directory(), SOURCE_DIR)

		expect(sync_fixture.read(APP_HTML)).toBe(custom_html)
		expect(sync_fixture.read(APP_D_TS)).toBe(custom_dts)
	})

	it('reports created files when absent and skipped on a re-run', () => {
		const first = cloudflare_sync.apply_overlay(sync_fixture.directory(), SOURCE_DIR)
		const second = cloudflare_sync.apply_overlay(sync_fixture.directory(), SOURCE_DIR)

		expect(first.find((change) => change.file === APP_HTML)?.action).toBe('created')
		expect(second.find((change) => change.file === APP_HTML)?.action).toBe('skipped')
		expect(cloudflare_sync.summarize(first)).toContain('created: src/app.html')
	})
})

describe('cloudflare sync overlay — cspell / tsconfig SvelteKit lines', () => {
	it('reconciles the kit sveltekit import to app-kit when the consumer config exists', () => {
		const cspell = `version: '0.2'\nimport:\n  - '${KIT_CSPELL}'\nwords: []\n`

		writeFileSync(sync_fixture.path_of(CSPELL_FILE), cspell)

		const changes = cloudflare_sync.apply_overlay(sync_fixture.directory(), SOURCE_DIR)

		expect(changes.find((change) => change.file === CSPELL_FILE)?.action).toBe('updated')
		expect(sync_fixture.read(CSPELL_FILE)).toContain(APP_KIT_CSPELL)
		expect(sync_fixture.read(CSPELL_FILE)).not.toContain(KIT_CSPELL)
	})

	it('skips the cspell / tsconfig patch when the consumer config files are absent', () => {
		const changes = cloudflare_sync.apply_overlay(sync_fixture.directory(), SOURCE_DIR)

		expect(changes.find((change) => change.file === CSPELL_FILE)?.action).toBe('skipped')
		expect(changes.find((change) => change.file === TSCONFIG_FILE)?.action).toBe('skipped')
	})
})
