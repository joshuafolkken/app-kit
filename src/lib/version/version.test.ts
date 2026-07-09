import { readFileSync } from 'node:fs'
import { cloudflare_orchestrate } from '#cloudflare/orchestrate.js'
import { describe, expect, it } from 'vitest'
import { app_version } from './version.js'

const PACKAGE_NAME = '@joshuafolkken/app-kit'
const SELF_DIR = '/workspace/app-kit/dist/scripts'
const STUB_LATEST = '9.9.9'
const KIT_MANIFEST = `${process.cwd()}/node_modules/@joshuafolkken/kit/package.json`

describe('app version commands', () => {
	it('builds a kit version-command config targeting app-kit', () => {
		const config = app_version.build_config(SELF_DIR)

		expect(config.package_name).toBe(PACKAGE_NAME)
		expect(config.versions_endpoint).toContain('app-kit/versions')
		expect(config.self_directory).toBe(SELF_DIR)
	})

	it('derives the fix-gh-packages path to kit single published copy (kit#637)', () => {
		const config = app_version.build_config(SELF_DIR)

		// kit >=1.4.0 always targets its own shipped script — app-kit publishes no scripts/, so a
		// package-name-derived path would point at a file that does not exist (kit#622 / kit#637)
		expect(config.fix_gh_packages_path).toContain('@joshuafolkken/kit/scripts/fix-gh-packages')
	})

	it('includes the kit upstream in the version chain', () => {
		const config = app_version.build_config(SELF_DIR)

		expect(config.upstreams).toHaveLength(1)

		const [kit_upstream] = config.upstreams

		expect(kit_upstream?.package_name).toBe('@joshuafolkken/kit')
		expect(kit_upstream?.versions_endpoint).toContain('/npm/kit/versions')
	})
})

describe('app version — kit effective-global hooks (app-kit#83)', () => {
	it('wires both effective-global hooks onto the kit upstream', () => {
		const [kit_upstream] = app_version.build_config(SELF_DIR, () => STUB_LATEST).upstreams

		// Both hooks must be present — kit only builds the effective report when both are defined.
		expect(typeof kit_upstream?.resolve_effective_version).toBe('function')
		expect(typeof kit_upstream?.resolve_global_upgrade_command).toBe('function')
	})

	it('reports kit effective version via the running-relative resolver', () => {
		const [kit_upstream] = app_version.build_config(SELF_DIR, () => STUB_LATEST).upstreams
		const installed = JSON.parse(readFileSync(KIT_MANIFEST, 'utf8')) as { version: string }

		expect(kit_upstream?.resolve_effective_version?.()).toBe(installed.version)
		expect(kit_upstream?.resolve_effective_version?.()).toBe(
			cloudflare_orchestrate.resolve_kit_effective_version(),
		)
	})

	it('upgrades the downstream global app-kit (not bare kit) at the fetched latest', () => {
		const [kit_upstream] = app_version.build_config(SELF_DIR, () => STUB_LATEST).upstreams

		// Bumping the global app-kit is what bumps the bundled kit; a bare `pnpm add -g kit` is wrong.
		expect(kit_upstream?.resolve_global_upgrade_command?.()).toBe(
			`pnpm add -g ${PACKAGE_NAME}@${STUB_LATEST}`,
		)
	})
})
