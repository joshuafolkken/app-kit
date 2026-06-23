import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const ENCODING = 'utf8'
const MANIFEST = 'package.json'
const KIT = '@joshuafolkken/kit'

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

// eslint and cspell layer on kit's base (re-export / import) — no fork. tsconfig
// is self-contained by necessity: TS cannot resolve a cross-package `extends` to a
// `.jsonc`, so it carries the SvelteKit compiler delta directly (kit does the same).
describe('presets layer on kit base where resolution allows', () => {
	it('eslint preset re-exports kit, never reimplements it', () => {
		const source = read_file('eslint/sveltekit.js')

		expect(source).toMatch(/export\s*\{[^}]*\}\s*from\s*'@joshuafolkken\/kit\/eslint\/sveltekit'/u)
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
