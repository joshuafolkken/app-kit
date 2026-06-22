// Dependency-free dark / light theme store (Svelte 5 runes).
// Imported only via `@joshuafolkken/app-kit/theme`; never re-exported from the
// package root barrel, so consumers that do not use it never bundle it.

type Theme = 'dark' | 'light'

const STORAGE_KEY = 'app-kit-theme'
const DARK: Theme = 'dark'
const LIGHT: Theme = 'light'

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

function read_stored(): Theme | undefined {
	if (!is_browser()) return undefined

	const value = read_storage(STORAGE_KEY)

	return value === DARK || value === LIGHT ? value : undefined
}

function reflect_to_dom(theme: Theme): void {
	if (!is_browser()) return

	document.documentElement.classList.toggle(DARK, theme === DARK)
	write_storage(STORAGE_KEY, theme)
}

class ThemeStore {
	#theme = $state<Theme>(LIGHT)

	get theme(): Theme {
		return this.#theme
	}

	get is_dark(): boolean {
		return this.#theme === DARK
	}

	set_theme(theme: Theme): void {
		this.#theme = theme
		reflect_to_dom(theme)
	}

	toggle(): void {
		this.set_theme(this.#theme === DARK ? LIGHT : DARK)
	}

	init(): void {
		this.set_theme(read_stored() ?? LIGHT)
	}
}

const theme_store = new ThemeStore()

export { theme_store }
export type { Theme }
