import { existsSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { sync_fixture } from './sync-fixture.js'

// #188 extracted this scaffolding out of sync.test.ts so two test files could share one fixture.
// That turned `state.directory` from a file-local binding into module state any test file can reach
// before `create()` has run — and an empty directory makes every fixture path resolve against
// app-kit's own repo root. These guard the refusal, because the failure mode is not a red test: it
// is `write_manifest` silently overwriting the canonical package.json this suite reads back.
describe('sync_fixture path guards', () => {
	afterEach(() => {
		sync_fixture.remove()
	})

	it('refuses to resolve a path before create()', () => {
		expect(() => sync_fixture.path_of(sync_fixture.PACKAGE_JSON)).toThrow(/create\(\)/u)
		expect(() => sync_fixture.directory()).toThrow(/create\(\)/u)
	})

	it('refuses again after remove(), so a torn-down fixture cannot reach the repo root', () => {
		sync_fixture.create()
		const created = sync_fixture.directory()

		sync_fixture.remove()

		expect(existsSync(created)).toBe(false)
		expect(() => sync_fixture.path_of(sync_fixture.PACKAGE_JSON)).toThrow(/create\(\)/u)
	})
})
