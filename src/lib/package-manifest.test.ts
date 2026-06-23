import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const ENCODING = 'utf8'
const MANIFEST = 'package.json'
const SCOPED_NAME = '@joshuafolkken/app-kit'
const GH_PACKAGES_REGISTRY = 'https://npm.pkg.github.com'

interface Manifest {
	name: string
	publishConfig?: { registry?: string; access?: string }
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
