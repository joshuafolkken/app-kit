import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { locale_store } from './Locale.svelte.js'

const ENCODING = 'utf8'
const MANIFEST = 'package.json'

interface Manifest {
	sideEffects: boolean | Array<string>
	exports: Record<string, unknown>
}

function load_manifest(): Manifest {
	return JSON.parse(readFileSync(MANIFEST, ENCODING)) as Manifest
}

describe('locale_store (SSR-safe, no DOM)', () => {
	it('set_locale updates state without throwing when document is absent', () => {
		expect(typeof document).toBe('undefined')
		expect(() => {
			locale_store.set_locale('ja')
		}).not.toThrow()
		expect(locale_store.is_ja).toBe(true)
	})

	it('toggle and init are safe without a browser', () => {
		locale_store.set_locale('en')

		expect(() => {
			locale_store.toggle()
		}).not.toThrow()
		expect(locale_store.is_ja).toBe(true)
		expect(() => {
			locale_store.init()
		}).not.toThrow()
	})
})

// The runtime bundle exclusion (unused `./i18n` => 0 occurrences in a consumer
// bundle) follows the same contract proven for `./theme`. These tests lock in the
// structural conditions that guarantee it, parsed from the manifest so they fail
// only on real contract drift.
describe('package contract that enables i18n tree-shaking', () => {
	it('declares a restrictive sideEffects field (false or a CSS-only allowlist)', () => {
		const { sideEffects: side_effects } = load_manifest()
		const is_restrictive =
			side_effects === false ||
			(Array.isArray(side_effects) && side_effects.every((path) => path.endsWith('.css')))

		expect(is_restrictive).toBe(true)
	})

	it('exposes i18n only through its own subpath, not the root export', () => {
		const { exports } = load_manifest()

		expect(exports['./i18n']).toBeDefined()
		expect(JSON.stringify(exports['.'])).not.toMatch(/i18n/u)
	})

	it('keeps i18n out of the root barrel so importing the package never pulls it', () => {
		const barrel = readFileSync('src/lib/index.ts', ENCODING)

		expect(barrel).not.toMatch(/from\s+['"][^'"]*i18n/u)
	})
})
