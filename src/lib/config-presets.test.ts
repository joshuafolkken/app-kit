import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const ENCODING = 'utf8'
const MANIFEST = 'package.json'
const KIT = '@joshuafolkken/kit'
const ESLINT_PRESET = 'eslint/sveltekit.js'

interface Manifest {
	files: Array<string>
	exports: Record<string, unknown>
	peerDependencies: Record<string, string>
}

function load_manifest(): Manifest {
	return JSON.parse(readFileSync(MANIFEST, ENCODING)) as Manifest
}

function read_file(path: string): string {
	return readFileSync(path, ENCODING)
}

// S1 (#26): app-kit owns the SvelteKit config presets, built ON kit's generic
// base (kit base + delta, no fork). These lock the export surface and the
// "extends/import/re-export kit, never copy" contract.
describe('SvelteKit config preset exports', () => {
	it('exposes the three /sveltekit preset subpaths', () => {
		const { exports } = load_manifest()

		expect(exports['./eslint/sveltekit']).toBe('./eslint/sveltekit.js')
		expect(exports['./tsconfig/sveltekit']).toMatchObject({ default: './tsconfig/sveltekit.jsonc' })
		expect(exports['./cspell/sveltekit']).toBe('./cspell/sveltekit.yaml')
	})

	it('publishes the preset directories and declares kit as a peer', () => {
		const { files, peerDependencies: peer_dependencies } = load_manifest()

		expect(files).toEqual(expect.arrayContaining(['eslint', 'tsconfig', 'cspell']))
		expect(peer_dependencies[KIT]).toBeDefined()
	})
})

// eslint is now INTERNALIZED (#52, epic #9 Phase C): it composes kit's generic base +
// eslint-plugin-svelte + app-kit's own SvelteKit delta in-house, instead of re-exporting
// kit's `create_sveltekit_config`. cspell still imports kit base; tsconfig is self-contained
// by necessity (TS cannot resolve a cross-package `extends` to a `.jsonc`).
describe('presets layer on kit base where resolution allows', () => {
	it('eslint preset is internalized: composes kit base + svelte delta, no kit/eslint/sveltekit re-export', () => {
		const source = read_file(ESLINT_PRESET)

		// no longer wraps kit's SvelteKit preset
		expect(source).not.toMatch(/@joshuafolkken\/kit\/eslint\/sveltekit/u)
		// composes the generic base + the generic test-filename policy by IMPORT (not clone)
		expect(source).toMatch(/create_base_config[\s\S]*from\s*'@joshuafolkken\/kit\/eslint\/base'/u)
		expect(source).toMatch(/from\s*'@joshuafolkken\/kit\/eslint\/test-filename'/u)
		// owns the Svelte plugin baseline + the SvelteKit-specific delta
		expect(source).toMatch(/from\s*'eslint-plugin-svelte'/u)
		expect(source).toMatch(/from\s*'\.\/rules\/svelte\.js'/u)
	})

	it('applies the generic test-filename rules last so route/param overrides cannot cancel the spec ban (kit#626)', () => {
		const source = read_file(ESLINT_PRESET)
		// inspect the composition body so each block name appears exactly once (its spread arg)
		const body = source.slice(source.indexOf('function create_sveltekit_config'))

		const parameter_index = body.indexOf('parameter_overrides')
		const spec_index = body.indexOf('spec_filename_overrides')
		const centralized_index = body.indexOf('centralized_tests_overrides')

		expect(parameter_index).toBeGreaterThan(-1)
		expect(spec_index).toBeGreaterThan(parameter_index)
		expect(centralized_index).toBeGreaterThan(parameter_index)
	})

	it('owns the Svelte unicorn override (no-top-level-assignment-in-function off for Svelte source)', () => {
		const source = read_file(ESLINT_PRESET)

		expect(source).toMatch(/'unicorn\/no-top-level-assignment-in-function':\s*'off'/u)
	})

	it('cspell preset imports kit base', () => {
		const source = read_file('cspell/sveltekit.yaml')

		expect(source).toMatch(/@joshuafolkken\/kit\/cspell/u)
	})

	it('tsconfig preset carries the SvelteKit compiler delta', () => {
		const source = read_file('tsconfig/sveltekit.jsonc')

		expect(source).toMatch(/"rewriteRelativeImportExtensions":\s*true/u)
		expect(source).toMatch(/"checkJs":\s*true/u)
	})
})

// Issue #58: SvelteKit page-option exports (ssr/csr/prerender) are framework-reserved
// boolean names whose spelling is fixed by the contract, so they can never satisfy
// unicorn/consistent-boolean-name's is_/has_ prefix. app-kit appends a route-scoped
// scope-off for these names; non-reserved route booleans stay strict. The preset is a
// hand-authored .js that imports kit's untyped eslint subpath, so it is asserted via
// source text (matching the preset tests above) rather than executed — importing it
// would drag the untyped module into the typed test program.
describe('SvelteKit reserved route boolean exports (#58)', () => {
	it('appends a route-scoped consistent-boolean-name override ignoring ssr/csr/prerender', () => {
		const source = read_file(ESLINT_PRESET)

		// the route globs are single-sourced as SVELTE_FILE_PATTERNS.routes; the boolean
		// override scopes itself to them (internalized form — no inline duplicate literal)
		expect(source).toMatch(
			/routes:\s*\[\s*'src\/routes\/\*\*\/\+\*\.ts',\s*'src\/routes\/\*\*\/\+\*\.js'\s*\]/u,
		)
		expect(source).toMatch(
			/route_boolean_name_overrides\s*=\s*\{\s*files:\s*SVELTE_FILE_PATTERNS\.routes/u,
		)
		expect(source).toMatch(/'unicorn\/consistent-boolean-name':\s*\['error',\s*\{\s*ignore:/u)
		expect(source).toMatch(/'\^ssr\$',\s*'\^csr\$',\s*'\^prerender\$'/u)
	})
})
