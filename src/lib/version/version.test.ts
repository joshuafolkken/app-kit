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

	it('derives the fix-gh-packages path from the app-kit package name', () => {
		const config = app_version.build_config(SELF_DIR)

		expect(config.fix_gh_packages_path).toContain(PACKAGE_NAME)
	})

	it('includes the kit upstream in the version chain', () => {
		const config = app_version.build_config(SELF_DIR)

		expect(config.upstreams).toHaveLength(1)

		const [kit_upstream] = config.upstreams

		expect(kit_upstream?.package_name).toBe('@joshuafolkken/kit')
		expect(kit_upstream?.versions_endpoint).toContain('/npm/kit/versions')
	})
})
