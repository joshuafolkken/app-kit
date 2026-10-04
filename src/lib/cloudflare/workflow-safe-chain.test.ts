import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// kit's shared action, rewritten on every sync; ci.yml prepares pnpm through it and the two
// app-kit workflows follow the same path, so the safe-chain installer lives in one place.
const SHARED_ACTION = '.github/actions/setup-pnpm/action.yml'
const APP_KIT_WORKFLOWS = ['.github/workflows/dast.yml', '.github/workflows/load.yml']
const SHARED_STEP = '        uses: ./.github/actions/setup-pnpm\n'
// A "Setup safe-chain" step written into the workflow itself rather than taken from the action.
const INLINE_SETUP_RE = / {6}- name: Setup safe-chain\n/u
const INLINE_INSTALL = 'pnpm install'
const CHECKED_INSTALLER = 'sha256sum -c -'
const LEGACY_SETUP = 'setup-ci'

function read_workflow(file: string): string {
	return readFileSync(file, 'utf8')
}

describe('shared pnpm setup action', () => {
	it('installs safe-chain from the hash-checked release installer', () => {
		const action = read_workflow(SHARED_ACTION)

		expect(action).toContain('- name: Setup safe-chain')
		expect(action).toContain(CHECKED_INSTALLER)
	})
})

describe.each(APP_KIT_WORKFLOWS)('safe-chain setup in %s', (file) => {
	const content = read_workflow(file)

	it('installs through the shared setup-pnpm action exactly once', () => {
		expect(content.split(SHARED_STEP)).toHaveLength(2)
	})

	it('carries no inline safe-chain or install step of its own', () => {
		expect(content).not.toMatch(INLINE_SETUP_RE)
		expect(content).not.toContain(INLINE_INSTALL)
	})

	it('no longer calls the legacy setup-ci shim installer', () => {
		expect(content).not.toContain(LEGACY_SETUP)
	})
})
