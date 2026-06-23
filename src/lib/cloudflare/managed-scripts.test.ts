import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { managed_scripts } from './managed-scripts.js'

const ENCODING = 'utf8'
const MANIFEST = 'package.json'
const PREPARE_KEY = 'prepare'

interface Manifest {
	scripts: Record<string, string>
}

function load_scripts(): Record<string, string> {
	return (JSON.parse(readFileSync(MANIFEST, ENCODING)) as Manifest).scripts
}

function read(path: string): string {
	return readFileSync(path, ENCODING)
}

// S2 (#27): app-kit's own package.json is the single source of the Cloudflare
// lifecycle scripts. These guards fail CI if app-kit drifts from the set it
// distributes, or if a managed script is renamed / removed.
describe('Cloudflare managed-scripts single source', () => {
	it('app-kit package.json defines every managed script key', () => {
		const scripts = load_scripts()

		for (const key of managed_scripts.MANAGED_SCRIPT_KEYS) {
			expect(scripts[key], `scripts.${key}`).toBeTypeOf('string')
		}
	})

	it('CANONICAL_PREPARE matches app-kit package.json (npm strips this key on publish)', () => {
		expect(load_scripts()[PREPARE_KEY]).toBe(managed_scripts.CANONICAL_PREPARE)
	})

	it('read_canonical_scripts returns a non-empty value for every managed key', () => {
		const canonical = managed_scripts.read_canonical_scripts(MANIFEST)

		for (const key of managed_scripts.MANAGED_SCRIPT_KEYS) {
			expect(canonical[key]).toBeTruthy()
		}
	})
})

// The published app-shell templates must stay byte-identical to the files app-kit
// itself ships, so the seed a consumer scaffolds from is always what app-kit runs.
describe('app-shell templates mirror app-kit own files', () => {
	it('templates/app.html equals src/app.html', () => {
		expect(read('templates/app.html')).toBe(read('src/app.html'))
	})

	it('templates/app.d.ts equals src/app.d.ts', () => {
		expect(read('templates/app.d.ts')).toBe(read('src/app.d.ts'))
	})
})
