import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { isBuiltin } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
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
// A declaration file's imports are erased before anything runs, so they are resolved through the
// `types` condition and never through a runtime one. Counting them would mean asking a type-only
// import to satisfy a runtime contract it is not subject to.
const DECLARATION_SUFFIX = '.d.ts'

function list_files_by_extension(
	directory: string,
	extensions: ReadonlyArray<string>,
): Array<string> {
	return readdirSync(directory, { recursive: true, encoding: ENCODING })
		.filter((entry) => !entry.endsWith(DECLARATION_SUFFIX))
		.filter((entry) => extensions.some((extension) => entry.endsWith(extension)))
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

/** Every module specifier imported by any file of the given extensions under `directory`. */
function collect_imported_specifiers(
	directory: string,
	extensions: ReadonlyArray<string>,
): Array<string> {
	return list_files_by_extension(directory, extensions).flatMap((file) =>
		extract_import_specifiers(readFileSync(file, ENCODING)),
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
	const names = collect_imported_specifiers(ESLINT_PRESET_DIR, PRESET_MODULE_EXTENSIONS)
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

const TEMPLATES_DIR = 'templates'
// Every extension a seeded spec could be authored in, not just the `.ts` used today — a template
// added as plain `.js` tomorrow would otherwise slip past the coverage check below, which is the
// one dimension this whole guard exists to cover.
const TEMPLATE_MODULE_EXTENSIONS = ['.ts', ...PRESET_MODULE_EXTENSIONS]

// #132: each subpath a consumer may import from a plain Node runner, paired with the file it must
// resolve to. `.`, `./theme` and `./i18n` are deliberately absent — their built modules re-export
// runes (`$state`), which plain Node cannot execute at all, so a `default` condition there would
// trade a precise "subpath is not exported" for a baffling "$state is not defined" at load time.
const NODE_RESOLVABLE_SUBPATHS: ReadonlyArray<readonly [string, string]> = [
	['./security', 'dist/security/index.js'],
	['./security/e2e', 'dist/security/e2e.js'],
]

function subpath_to_specifier(subpath: string): string {
	return `${SCOPED_NAME}${subpath.slice(1)}`
}

function specifier_to_subpath(specifier: string): string {
	return `.${specifier.slice(SCOPED_NAME.length)}`
}

/**
 * Resolve a bare specifier through Node's own algorithm, under the condition set a consumer's
 * Playwright run uses (`["node", "import"]`, no `svelte`). Throws when the subpath is not exported.
 * `import.meta.resolve` performs no I/O, so this holds whether or not `dist/` has been built.
 */
function resolve_from_plain_node(specifier: string): string {
	const script = `process.stdout.write(import.meta.resolve(${JSON.stringify(specifier)}))`

	return execFileSync(process.execPath, ['--input-type=module', '-e', script], {
		encoding: ENCODING,
		stdio: ['ignore', 'pipe', 'pipe'],
	})
}

function collect_template_subpaths(): Array<string> {
	const own = collect_imported_specifiers(TEMPLATES_DIR, TEMPLATE_MODULE_EXTENSIONS)
		.filter((specifier) => to_package_name(specifier) === SCOPED_NAME)
		.map((specifier) => specifier_to_subpath(specifier))

	return [...new Set(own)]
}

// Regression guard for #132: `./security/e2e` shipped with only `types` + `svelte` conditions, so
// Playwright — which transpiles specs and runs them in Node, resolving with ["node", "import"] —
// matched neither and reported the subpath as not exported. The distributed security-headers net
// therefore failed to COLLECT in every consumer: not skipped, not failed, never loaded.
//
// Re-running Playwright HERE would not have caught it. app-kit's own copy of the spec rewrites the
// consumer's `@joshuafolkken/app-kit/security/e2e` import to `$lib/security/e2e.js` (see
// workflow-distribution.test.ts), so this repo's E2E never touches the export map at all — only a
// consumer does. Resolving the subpath the way a consumer's runner does is the guard.
describe('published subpaths resolve for the runner that consumes them (#132)', () => {
	it.each(NODE_RESOLVABLE_SUBPATHS)('resolves %s without the svelte condition', (subpath, file) => {
		const resolved = resolve_from_plain_node(subpath_to_specifier(subpath))

		expect(resolved).toBe(pathToFileURL(path.resolve(file)).href)
	})

	// Ties the contract to what is actually distributed: a template seeded into `src/routes` is run
	// by the consumer's Playwright, so every app-kit subpath it names has to be in the list above.
	it('covers every app-kit subpath the distributed templates import', () => {
		const imported = collect_template_subpaths()
		const contracted = new Set(NODE_RESOLVABLE_SUBPATHS.map(([subpath]) => subpath))

		// A template that imports nothing from app-kit would make the filter below vacuously pass.
		expect(imported).not.toEqual([])
		expect(imported.filter((subpath) => !contracted.has(subpath))).toEqual([])
	})
})
