import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cloudflare_init } from './init.js'
import { managed_scripts } from './managed-scripts.js'

const ENCODING = 'utf8'
const SOURCE_DIR = '.'
const WRANGLER_JSONC = 'wrangler.jsonc'
const WRANGLER_TEMPLATE = 'templates/wrangler.jsonc'
const PACKAGE_JSON = 'package.json'
const PLACEHOLDER_MARKER = 'your-project-name'

const state = { directory: '' }

function fixture_path(relative_path: string): string {
	return path.join(state.directory, relative_path)
}

function read_fixture(relative_path: string): string {
	return readFileSync(fixture_path(relative_path), ENCODING)
}

beforeEach(() => {
	state.directory = mkdtempSync(path.join(tmpdir(), 'app-kit-init-'))
})

afterEach(() => {
	rmSync(state.directory, { recursive: true, force: true })
})

describe('derive_worker_name', () => {
	it('drops the npm scope and reduces the name to a worker-name slug', () => {
		expect(cloudflare_init.derive_worker_name('@scope/blog')).toBe('blog')
		expect(cloudflare_init.derive_worker_name('My Cool App')).toBe('my-cool-app')
		expect(cloudflare_init.derive_worker_name('  Trimmed  ')).toBe('trimmed')
		expect(cloudflare_init.derive_worker_name('@scope/')).toBe('')
	})
})

describe('set_worker_name', () => {
	beforeEach(() => {
		copyFileSync(WRANGLER_TEMPLATE, fixture_path(WRANGLER_JSONC))
	})

	it('fills the commented name placeholder with the derived name', () => {
		cloudflare_init.set_worker_name(state.directory, 'blog')

		const wrangler = read_fixture(WRANGLER_JSONC)

		expect(wrangler).toContain('"name": "blog",')
		expect(wrangler).not.toContain(PLACEHOLDER_MARKER)
	})

	it('is idempotent and never overwrites a name the consumer already set', () => {
		cloudflare_init.set_worker_name(state.directory, 'first')
		const after_first = read_fixture(WRANGLER_JSONC)

		cloudflare_init.set_worker_name(state.directory, 'second')

		expect(read_fixture(WRANGLER_JSONC)).toBe(after_first)
	})

	it('leaves the placeholder untouched for an empty derived name', () => {
		cloudflare_init.set_worker_name(state.directory, '')

		expect(read_fixture(WRANGLER_JSONC)).toContain(PLACEHOLDER_MARKER)
	})
})

describe('init_overlay', () => {
	it('applies the sync overlay and sets the Worker name from the project name', () => {
		const manifest = { name: 'fixture', scripts: {} }

		writeFileSync(fixture_path(PACKAGE_JSON), `${JSON.stringify(manifest, undefined, '\t')}\n`)
		cloudflare_init.init_overlay(state.directory, SOURCE_DIR, '@scope/my-app')

		const parsed = JSON.parse(read_fixture(PACKAGE_JSON)) as { scripts: Record<string, string> }

		for (const key of managed_scripts.MANAGED_SCRIPT_KEYS) {
			expect(parsed.scripts[key], key).toBeTypeOf('string')
		}

		expect(read_fixture(WRANGLER_JSONC)).toContain('"name": "my-app",')
	})
})

describe('run_init', () => {
	it('derives the Worker name from the project package.json name', () => {
		const manifest = { name: '@scope/from-pkg', scripts: {} }

		writeFileSync(fixture_path(PACKAGE_JSON), `${JSON.stringify(manifest, undefined, '\t')}\n`)
		cloudflare_init.run_init(state.directory, SOURCE_DIR)

		expect(read_fixture(WRANGLER_JSONC)).toContain('"name": "from-pkg",')
	})

	it('leaves the placeholder when the package.json name is not a string', () => {
		const manifest = { name: 123, scripts: {} }

		writeFileSync(fixture_path(PACKAGE_JSON), `${JSON.stringify(manifest, undefined, '\t')}\n`)
		cloudflare_init.run_init(state.directory, SOURCE_DIR)

		expect(read_fixture(WRANGLER_JSONC)).toContain(PLACEHOLDER_MARKER)
	})
})
