import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { managed_scripts } from './managed-scripts.js'
import { cloudflare_sync } from './sync.js'

const ENCODING = 'utf8'
// app-kit's repo root: holds the canonical package.json + templates/.
const SOURCE_DIR = '.'
const PACKAGE_JSON = 'package.json'
const WRANGLER_JSONC = 'wrangler.jsonc'
const WRANGLER_TEMPLATE = 'templates/wrangler.jsonc'
const APP_HTML = 'src/app.html'
const APP_D_TS = 'src/app.d.ts'
const KIT_OWNED = 'eslint.config.js'
const KIT_OWNED_CONTENT = '// kit-owned — must not be touched\n'
const DEV_KEY = 'dev'
const DEV_VALUE = 'vite dev'
const FIXTURE_NAME = 'fixture'
const PLACEHOLDER_MARKER = 'your-project-name'
const CSPELL_FILE = 'cspell.config.yaml'
const TSCONFIG_FILE = 'tsconfig.json'
const KIT_CSPELL = '@joshuafolkken/kit/cspell/sveltekit'
const APP_KIT_CSPELL = '@joshuafolkken/app-kit/cspell/sveltekit'
const VSCODE_SETTINGS = '.vscode/settings.json'
const VSCODE_TEMPLATE = 'templates/settings.sveltekit.json'

// Holder avoids reassigning a top-level binding from inside the lifecycle hooks.
const state = { directory: '' }

function fixture_path(relative_path: string): string {
	return path.join(state.directory, relative_path)
}

function read_fixture(relative_path: string): string {
	return readFileSync(fixture_path(relative_path), ENCODING)
}

function fixture_scripts(): Record<string, string> {
	return (JSON.parse(read_fixture(PACKAGE_JSON)) as { scripts: Record<string, string> }).scripts
}

beforeEach(() => {
	state.directory = mkdtempSync(path.join(tmpdir(), 'app-kit-overlay-'))
	const manifest = { name: FIXTURE_NAME, scripts: { [DEV_KEY]: DEV_VALUE } }

	writeFileSync(fixture_path(PACKAGE_JSON), `${JSON.stringify(manifest, undefined, '\t')}\n`)
	writeFileSync(fixture_path(KIT_OWNED), KIT_OWNED_CONTENT)
})

afterEach(() => {
	rmSync(state.directory, { recursive: true, force: true })
})

describe('cloudflare sync overlay', () => {
	it('adds the managed scripts, app-shell templates, and seeds wrangler.jsonc', () => {
		cloudflare_sync.apply_overlay(state.directory, SOURCE_DIR)

		const scripts = fixture_scripts()

		for (const key of managed_scripts.MANAGED_SCRIPT_KEYS) {
			expect(scripts[key], key).toBeTypeOf('string')
		}

		expect(read_fixture(APP_HTML)).toBe(readFileSync('templates/app.html', ENCODING))
		expect(read_fixture(WRANGLER_JSONC)).toBe(readFileSync(WRANGLER_TEMPLATE, ENCODING))
		expect(read_fixture(VSCODE_SETTINGS)).toBe(readFileSync(VSCODE_TEMPLATE, ENCODING))
	})

	it('preserves the consumer non-managed scripts and kit-owned files', () => {
		cloudflare_sync.apply_overlay(state.directory, SOURCE_DIR)

		expect(fixture_scripts()[DEV_KEY]).toBe(DEV_VALUE)
		expect(read_fixture(KIT_OWNED)).toBe(KIT_OWNED_CONTENT)
	})

	it('is idempotent — a second overlay leaves package.json byte-identical', () => {
		cloudflare_sync.apply_overlay(state.directory, SOURCE_DIR)
		const after_first = read_fixture(PACKAGE_JSON)

		cloudflare_sync.apply_overlay(state.directory, SOURCE_DIR)

		expect(read_fixture(PACKAGE_JSON)).toBe(after_first)
	})

	it('does not rewrite an app-shell template whose content is unchanged', () => {
		cloudflare_sync.apply_overlay(state.directory, SOURCE_DIR)
		const before = statSync(fixture_path(APP_HTML)).mtimeMs

		cloudflare_sync.apply_overlay(state.directory, SOURCE_DIR)

		expect(statSync(fixture_path(APP_HTML)).mtimeMs).toBe(before)
	})
})

describe('cloudflare sync overlay — non-destructive & summary', () => {
	it('does not overwrite an already-customized app.html / app.d.ts', () => {
		const custom_html = '<!doctype html><html lang="%lang%"><!-- analytics --></html>\n'
		const custom_dts = '// custom env types\nexport {}\n'

		mkdirSync(fixture_path('src'), { recursive: true })
		writeFileSync(fixture_path(APP_HTML), custom_html)
		writeFileSync(fixture_path(APP_D_TS), custom_dts)
		cloudflare_sync.apply_overlay(state.directory, SOURCE_DIR)

		expect(read_fixture(APP_HTML)).toBe(custom_html)
		expect(read_fixture(APP_D_TS)).toBe(custom_dts)
	})

	it('reports created files when absent and skipped on a re-run', () => {
		const first = cloudflare_sync.apply_overlay(state.directory, SOURCE_DIR)
		const second = cloudflare_sync.apply_overlay(state.directory, SOURCE_DIR)

		expect(first.find((change) => change.file === APP_HTML)?.action).toBe('created')
		expect(second.find((change) => change.file === APP_HTML)?.action).toBe('skipped')
		expect(cloudflare_sync.summarize(first)).toContain('created: src/app.html')
	})
})

describe('cloudflare sync overlay — cspell / tsconfig SvelteKit lines', () => {
	it('reconciles the kit sveltekit import to app-kit when the consumer config exists', () => {
		const cspell = `version: '0.2'\nimport:\n  - '${KIT_CSPELL}'\nwords: []\n`

		writeFileSync(fixture_path(CSPELL_FILE), cspell)

		const changes = cloudflare_sync.apply_overlay(state.directory, SOURCE_DIR)

		expect(changes.find((change) => change.file === CSPELL_FILE)?.action).toBe('updated')
		expect(read_fixture(CSPELL_FILE)).toContain(APP_KIT_CSPELL)
		expect(read_fixture(CSPELL_FILE)).not.toContain(KIT_CSPELL)
	})

	it('skips the cspell / tsconfig patch when the consumer config files are absent', () => {
		const changes = cloudflare_sync.apply_overlay(state.directory, SOURCE_DIR)

		expect(changes.find((change) => change.file === CSPELL_FILE)?.action).toBe('skipped')
		expect(changes.find((change) => change.file === TSCONFIG_FILE)?.action).toBe('skipped')
	})
})

describe('cloudflare sync overlay — wrangler.jsonc', () => {
	it('does not re-seed a wrangler.jsonc the consumer already customized', () => {
		const custom = '{ "name": "my-worker" }\n'

		writeFileSync(fixture_path(WRANGLER_JSONC), custom)
		cloudflare_sync.apply_overlay(state.directory, SOURCE_DIR)

		expect(read_fixture(WRANGLER_JSONC)).toBe(custom)
	})

	it('preserves an existing wrangler.jsonc compatibility_date — never advances it', () => {
		const existing = '{\n\t"name": "kept-worker",\n\t"compatibility_date": "2020-01-01"\n}\n'

		writeFileSync(fixture_path(WRANGLER_JSONC), existing)
		cloudflare_sync.apply_overlay(state.directory, SOURCE_DIR)

		expect(read_fixture(WRANGLER_JSONC)).toBe(existing)
	})

	it('leaves the name placeholder — sync never derives the Worker name (init does)', () => {
		cloudflare_sync.apply_overlay(state.directory, SOURCE_DIR)

		const wrangler = read_fixture(WRANGLER_JSONC)

		expect(wrangler).toContain(PLACEHOLDER_MARKER)
		expect(wrangler).not.toContain(`"name": "${FIXTURE_NAME}"`)
	})
})

function vscode_template(): Record<string, unknown> {
	return JSON.parse(readFileSync(VSCODE_TEMPLATE, ENCODING)) as Record<string, unknown>
}

describe('cloudflare sync overlay — .vscode SvelteKit settings (#67)', () => {
	it('seeds .vscode/settings.json from the template when absent', () => {
		const changes = cloudflare_sync.apply_overlay(state.directory, SOURCE_DIR)

		expect(changes.find((change) => change.file === VSCODE_SETTINGS)?.action).toBe('created')
		expect(read_fixture(VSCODE_SETTINGS)).toBe(readFileSync(VSCODE_TEMPLATE, ENCODING))
	})

	it('does not overwrite a consumer-customized .vscode/settings.json', () => {
		const custom = '{ "editor.formatOnSave": false }\n'

		mkdirSync(fixture_path('.vscode'), { recursive: true })
		writeFileSync(fixture_path(VSCODE_SETTINGS), custom)
		const changes = cloudflare_sync.apply_overlay(state.directory, SOURCE_DIR)

		expect(changes.find((change) => change.file === VSCODE_SETTINGS)?.action).toBe('skipped')
		expect(read_fixture(VSCODE_SETTINGS)).toBe(custom)
	})

	it('ships the svelte editor delta and excludes project-specific / author-only keys', () => {
		const settings = vscode_template()

		expect(settings['eslint.validate']).toContain('svelte')
		expect(settings['eslint.probe']).toContain('svelte')
		expect(settings['svelte.language-server.runtime']).toBe('node')
		expect(settings['css.lint.unknownAtRules']).toBe('ignore')
		expect(settings).toHaveProperty('[svelte]')
		// project-specific (sonarlint) and author-only (claudeCode.*) keys must not be distributed
		expect(settings).not.toHaveProperty('sonarlint.connectedMode.project')
		expect(Object.keys(settings).some((key) => key.startsWith('claudeCode.'))).toBe(false)
	})
})
