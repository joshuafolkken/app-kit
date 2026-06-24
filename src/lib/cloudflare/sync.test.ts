import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
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
const KIT_OWNED = 'eslint.config.js'
const KIT_OWNED_CONTENT = '// kit-owned — must not be touched\n'
const DEV_KEY = 'dev'
const DEV_VALUE = 'vite dev'

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
	const manifest = { name: 'fixture', scripts: { [DEV_KEY]: DEV_VALUE } }

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

describe('cloudflare sync overlay — wrangler.jsonc', () => {
	it('does not re-seed a wrangler.jsonc the consumer already customized', () => {
		const custom = '{ "name": "my-worker" }\n'

		writeFileSync(fixture_path(WRANGLER_JSONC), custom)
		cloudflare_sync.apply_overlay(state.directory, SOURCE_DIR)

		expect(read_fixture(WRANGLER_JSONC)).toBe(custom)
	})

	it('refreshes an existing wrangler.jsonc compatibility_date but keeps its other fields', () => {
		const old_date = '2020-01-01'
		const worker = 'kept-worker'
		const template_date = /"compatibility_date":\s*"([^"]+)"/u.exec(
			readFileSync(WRANGLER_TEMPLATE, ENCODING),
		)?.[1]
		const existing = `{\n\t"name": "${worker}",\n\t"compatibility_date": "${old_date}"\n}\n`

		writeFileSync(fixture_path(WRANGLER_JSONC), existing)
		cloudflare_sync.apply_overlay(state.directory, SOURCE_DIR)

		const result = read_fixture(WRANGLER_JSONC)

		expect(result).toContain(worker)
		expect(result).toContain(template_date)
		expect(result).not.toContain(old_date)
	})
})
