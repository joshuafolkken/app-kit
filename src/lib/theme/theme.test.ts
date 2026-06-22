import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { theme_store } from './Theme.svelte.js'

const ENCODING = 'utf8'
const MANIFEST = 'package.json'

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

describe('theme tree-shaking guarantee', () => {
	it('declares a restrictive sideEffects field so unused subpaths are dropped', () => {
		const manifest = readFileSync(MANIFEST, ENCODING)

		// Either `false` or a CSS-only allowlist marks every other module as
		// side-effect-free, which is what lets bundlers drop an unused subpath.
		expect(manifest).toMatch(/"sideEffects":\s*(false|\[\s*"[^"]*\.css")/u)
	})

	it('exposes theme through its own subpath export', () => {
		const manifest = readFileSync(MANIFEST, ENCODING)

		expect(manifest).toContain('"./theme"')
	})

	it('keeps theme out of the root barrel so importing the package never pulls it', () => {
		const barrel = readFileSync('src/lib/index.ts', ENCODING)

		expect(barrel).not.toMatch(/from\s+['"][^'"]*theme/u)
	})
})
