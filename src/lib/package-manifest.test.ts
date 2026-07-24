import { readdirSync, readFileSync } from 'node:fs'
import { isBuiltin } from 'node:module'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { cloudflare_sync } from './cloudflare/sync.js'

const ENCODING = 'utf8'
const MANIFEST = 'package.json'
const SCOPED_NAME = '@joshuafolkken/app-kit'
const GH_PACKAGES_REGISTRY = 'https://npm.pkg.github.com'
const ESLINT_PRESET_DIR = 'eslint'
const SCOPED_PACKAGE_SEGMENTS = 2

interface Manifest {
	name: string
	publishConfig?: { registry?: string; access?: string }
	dependencies?: Record<string, string>
	peerDependencies?: Record<string, string>
	files?: ReadonlyArray<string>
}

function load_manifest(): Manifest {
	return JSON.parse(readFileSync(MANIFEST, ENCODING)) as Manifest
}

// Phase 0 (#30): the whole kit -> app-kit -> consumers program depends on the
// package being published under the @joshuafolkken scope to GitHub Packages.
// These lock the published identity so a rename revert / wrong registry fails CI.
describe('package publish contract', () => {
	it('is named under the @joshuafolkken scope', () => {
		expect(load_manifest().name).toBe(SCOPED_NAME)
	})

	it('publishes to GitHub Packages with public access', () => {
		const { publishConfig: publish_config } = load_manifest()

		expect(publish_config?.registry).toBe(GH_PACKAGES_REGISTRY)
		expect(publish_config?.access).toBe('public')
	})
})

function top_level_directory_of(template: string): string {
	return template.split('/', 1)[0] ?? ''
}

// `josh-app sync` reads every overlay source out of the INSTALLED package, so a directory missing
// from `files` fails only in a consumer — never in this repo, where the file is right there on
// disk. That is how the k6 scenarios could regress silently once they stopped living under the
// already-published templates/, so the coupling gets an explicit guard.
describe('published files cover the overlay sources', () => {
	it('publishes every directory the sync overlay seeds from', () => {
		const published = new Set(load_manifest().files)
		const sources = [...cloudflare_sync.SEED_ENTRIES, ...cloudflare_sync.MANAGED_COPY_ENTRIES]
		const directories = new Set(sources.map((entry) => top_level_directory_of(entry.template)))

		expect([...directories.difference(published)]).toEqual([])
	})
})

const PRESET_MODULE_EXTENSIONS = ['.js', '.mjs', '.cjs']

function list_preset_js_files(directory: string): Array<string> {
	return readdirSync(directory, { recursive: true, encoding: ENCODING })
		.filter((entry) => PRESET_MODULE_EXTENSIONS.some((extension) => entry.endsWith(extension)))
		.map((entry) => path.join(directory, entry))
}

const IMPORT_SPECIFIER_PATTERNS = [
	// `import x from '...'` / `export ... from '...'`
	/from\s+['"]([^'"]+)['"]/gu,
	// side-effect imports: `import '...'`
	/^import\s+['"]([^'"]+)['"]/gmu,
	// dynamic `import('...')` and CJS `require('...')`
	/(?:import|require)\(\s*['"]([^'"]+)['"]\s*\)/gu,
]

function extract_import_specifiers(source: string): Array<string> {
	return IMPORT_SPECIFIER_PATTERNS.flatMap((pattern) =>
		source
			.matchAll(pattern)
			.map((match) => match[1] ?? '')
			.toArray(),
	)
}

function is_bare_specifier(specifier: string): boolean {
	return specifier !== '' && !specifier.startsWith('.') && !isBuiltin(specifier)
}

function to_package_name(specifier: string): string {
	const segments = specifier.split('/')
	const length = specifier.startsWith('@') ? SCOPED_PACKAGE_SEGMENTS : 1

	return segments.slice(0, length).join('/')
}

function collect_preset_package_imports(): Array<string> {
	const files = list_preset_js_files(ESLINT_PRESET_DIR)
	const specifiers = files.flatMap((file) =>
		extract_import_specifiers(readFileSync(file, ENCODING)),
	)
	const names = specifiers
		.filter((specifier) => is_bare_specifier(specifier))
		.map((specifier) => to_package_name(specifier))

	return [...new Set(names)]
}

// Regression guard for #74: the shipped ESLint preset (eslint/**/*.js) is executed
// inside the consumer's node_modules, where app-kit's devDependencies are NOT
// installed. Every package the preset imports must therefore be declared as a
// regular dependency or a peerDependency, or consumers hit ERR_MODULE_NOT_FOUND.
describe('shipped eslint preset dependencies', () => {
	it('declares every package imported by eslint/**/*.js outside devDependencies', () => {
		const manifest = load_manifest()
		const declared = new Set([
			...Object.keys(manifest.dependencies ?? {}),
			...Object.keys(manifest.peerDependencies ?? {}),
		])
		const undeclared = collect_preset_package_imports().filter((name) => !declared.has(name))

		expect(undeclared).toEqual([])
	})

	it('ships eslint-plugin-svelte as a regular dependency', () => {
		expect(load_manifest().dependencies).toHaveProperty('eslint-plugin-svelte')
	})
})
