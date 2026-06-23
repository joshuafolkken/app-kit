// Dependency-free ja / en locale store (Svelte 5 runes).
// Imported only via `@joshuafolkken/app-kit/i18n`; never re-exported from the
// package root barrel, so consumers that do not use it never bundle it.
// Scope is locale selection only — Paraglide message integration is a later slice.

type Locale = 'ja' | 'en'

const STORAGE_KEY = 'app-kit-locale'
const JA: Locale = 'ja'
const EN: Locale = 'en'

function is_browser(): boolean {
	return typeof document !== 'undefined'
}

function read_storage(key: string): string | undefined {
	try {
		return localStorage.getItem(key) ?? undefined
	} catch {
		return undefined
	}
}

function write_storage(key: string, value: string): void {
	try {
		localStorage.setItem(key, value)
	} catch {
		// Restricted storage (private mode / disabled): keep in-memory + DOM state.
	}
}

function read_stored(): Locale | undefined {
	if (!is_browser()) return undefined

	const value = read_storage(STORAGE_KEY)

	return value === JA || value === EN ? value : undefined
}

function reflect_to_dom(locale: Locale): void {
	if (!is_browser()) return

	document.documentElement.lang = locale
	write_storage(STORAGE_KEY, locale)
}

class LocaleStore {
	#locale = $state<Locale>(EN)

	get locale(): Locale {
		return this.#locale
	}

	get is_ja(): boolean {
		return this.#locale === JA
	}

	set_locale(locale: Locale): void {
		this.#locale = locale
		reflect_to_dom(locale)
	}

	toggle(): void {
		this.set_locale(this.#locale === JA ? EN : JA)
	}

	init(): void {
		this.set_locale(read_stored() ?? EN)
	}
}

const locale_store = new LocaleStore()

export { locale_store }
export type { Locale }
