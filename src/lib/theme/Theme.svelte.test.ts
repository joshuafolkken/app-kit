import { beforeEach, describe, expect, it } from 'vitest'
import { theme_store, type Theme } from './Theme.svelte.js'

const STORAGE_KEY = 'app-kit-theme'
const DARK: Theme = 'dark'
const LIGHT: Theme = 'light'

beforeEach(() => {
	localStorage.clear()
	document.documentElement.classList.remove(DARK)
	theme_store.set_theme(LIGHT)
})

describe('theme_store (browser)', () => {
	it('starts in light mode', () => {
		expect(theme_store.is_dark).toBe(false)
		expect(theme_store.theme).toBe(LIGHT)
	})

	it('set_theme switches to dark and reflects to the document and storage', () => {
		theme_store.set_theme(DARK)

		expect(theme_store.is_dark).toBe(true)
		expect(document.documentElement.classList.contains(DARK)).toBe(true)
		expect(localStorage.getItem(STORAGE_KEY)).toBe(DARK)
	})

	it('toggle flips between light and dark', () => {
		theme_store.toggle()
		expect(theme_store.is_dark).toBe(true)

		theme_store.toggle()
		expect(theme_store.is_dark).toBe(false)
		expect(document.documentElement.classList.contains(DARK)).toBe(false)
	})

	it('init restores the persisted theme', () => {
		localStorage.setItem(STORAGE_KEY, DARK)

		theme_store.init()

		expect(theme_store.is_dark).toBe(true)
	})
})
