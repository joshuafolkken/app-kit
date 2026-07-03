import { describe, expect, it } from 'vitest'
import { app_version } from './version.js'

const PACKAGE_NAME = '@joshuafolkken/app-kit'
const SELF_DIR = '/workspace/app-kit/dist/scripts'

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
