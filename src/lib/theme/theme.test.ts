import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { theme_store } from './Theme.svelte.js'

const ENCODING = 'utf8'
const MANIFEST = 'package.json'

interface Manifest {
	sideEffects: boolean | Array<string>
	exports: Record<string, unknown>
}

function load_manifest(): Manifest {
	return JSON.parse(readFileSync(MANIFEST, ENCODING)) as Manifest
}

describe('theme_store (SSR-safe, no DOM)', () => {
	it('set_theme updates state without throwing when document is absent', () => {
		expect(typeof document).toBe('undefined')
		expect(() => {
			theme_store.set_theme('dark')
		}).not.toThrow()
		expect(theme_store.is_dark).toBe(true)
	})

	it('toggle and init are safe without a browser', () => {
		theme_store.set_theme('light')

		expect(() => {
			theme_store.toggle()
		}).not.toThrow()
		expect(theme_store.is_dark).toBe(true)
		expect(() => {
			theme_store.init()
		}).not.toThrow()
	})
})

// The runtime bundle exclusion (unused `./theme` => 0 occurrences in a consumer
// bundle) was verified end-to-end with esbuild during development. These tests
// lock in the structural conditions that guarantee it, parsed from the manifest
// so they fail only on real contract drift.
describe('package contract that enables theme tree-shaking', () => {
	it('declares a restrictive sideEffects field (false or a CSS-only allowlist)', () => {
		const { sideEffects: side_effects } = load_manifest()
		const is_restrictive =
			side_effects === false ||
			(Array.isArray(side_effects) && side_effects.every((path) => path.endsWith('.css')))

		expect(is_restrictive).toBe(true)
	})

	it('exposes theme only through its own subpath, not the root export', () => {
		const { exports } = load_manifest()

		expect(exports['./theme']).toBeDefined()
		expect(JSON.stringify(exports['.'])).not.toMatch(/theme/u)
	})

	it('keeps theme out of the root barrel so importing the package never pulls it', () => {
		const barrel = readFileSync('src/lib/index.ts', ENCODING)

		expect(barrel).not.toMatch(/from\s+['"][^'"]*theme/u)
	})
})
