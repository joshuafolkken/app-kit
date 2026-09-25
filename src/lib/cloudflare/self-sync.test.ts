import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { app_self_sync } from './self-sync.js'

const PACKAGE_ROOT = process.cwd()
const PACKAGE_NAME = '@joshuafolkken/app-kit'
const original_exit_code = process.exitCode

afterEach(() => {
	process.exitCode = original_exit_code
	vi.restoreAllMocks()
})

describe('app self-sync guard', () => {
	it('refuses this repository with a nonzero exit before syncing', () => {
		const error = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

		expect(app_self_sync.did_refuse_self_sync(PACKAGE_ROOT, PACKAGE_ROOT)).toBe(true)
		expect(process.exitCode).toBe(1)
		expect(error).toHaveBeenCalledWith(expect.stringContaining(PACKAGE_NAME))
	})

	it('allows a consumer project', () => {
		const consumer_root = mkdtempSync(path.join(tmpdir(), 'app-kit-consumer-'))
		const error = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

		try {
			writeFileSync(path.join(consumer_root, 'package.json'), '{"name":"consumer-app"}')
			expect(app_self_sync.did_refuse_self_sync(PACKAGE_ROOT, consumer_root)).toBe(false)
			expect(error).not.toHaveBeenCalled()
		} finally {
			rmSync(consumer_root, { recursive: true, force: true })
		}
	})
})
