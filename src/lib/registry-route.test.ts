import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const GITHUB_PACKAGES_HOST = 'npm.pkg.github.com'
const SCOPE_ROUTE = '@joshuafolkken:registry=https://registry.npmjs.org/'

// #306: app-kit installs its own @joshuafolkken packages from public npm, so a fresh checkout and CI
// need no GitHub Packages credential. `josh registry:migrate` wrote the route; `josh sync` keeps it.
describe('own @joshuafolkken registry route', () => {
	it('routes the scope to public npm in the project .npmrc', () => {
		const lines = readFileSync('.npmrc', 'utf8').split('\n')

		expect(lines).toContain(SCOPE_ROUTE)
	})

	it.each(['.npmrc', 'pnpm-lock.yaml'])('never resolves from GitHub Packages in %s', (file) => {
		expect(readFileSync(file, 'utf8')).not.toContain(GITHUB_PACKAGES_HOST)
	})
})
