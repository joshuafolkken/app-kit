import { beforeEach, describe, expect, it, vi } from 'vitest'
import { locale_store, type Locale } from './Locale.svelte.js'

const STORAGE_KEY = 'app-kit-locale'
const JA: Locale = 'ja'
const EN: Locale = 'en'
const STORAGE_ERROR = 'storage blocked'

beforeEach(() => {
	localStorage.clear()
	document.documentElement.removeAttribute('lang')
	locale_store.set_locale(EN)
})

describe('locale_store (browser)', () => {
	it('starts in English', () => {
		expect(locale_store.is_ja).toBe(false)
		expect(locale_store.locale).toBe(EN)
	})

	it('set_locale switches to ja and reflects to the document and storage', () => {
		locale_store.set_locale(JA)

		expect(locale_store.is_ja).toBe(true)
		expect(document.documentElement.lang).toBe(JA)
		expect(localStorage.getItem(STORAGE_KEY)).toBe(JA)
	})

	it('toggle flips between en and ja', () => {
		locale_store.toggle()
		expect(locale_store.is_ja).toBe(true)

		locale_store.toggle()
		expect(locale_store.is_ja).toBe(false)
		expect(document.documentElement.lang).toBe(EN)
	})

	it('init restores the persisted locale', () => {
		localStorage.setItem(STORAGE_KEY, JA)

		locale_store.init()

		expect(locale_store.is_ja).toBe(true)
	})
})

describe('locale_store storage resilience', () => {
	it('set_locale survives a throwing localStorage.setItem (private mode)', () => {
		const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new Error(STORAGE_ERROR)
		})

		expect(() => {
			locale_store.set_locale(JA)
		}).not.toThrow()
		expect(locale_store.is_ja).toBe(true)
		expect(document.documentElement.lang).toBe(JA)

		spy.mockRestore()
	})

	it('init survives a throwing localStorage.getItem (private mode)', () => {
		const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
			throw new Error(STORAGE_ERROR)
		})

		expect(() => {
			locale_store.init()
		}).not.toThrow()
		expect(locale_store.is_ja).toBe(false)

		spy.mockRestore()
	})
})
