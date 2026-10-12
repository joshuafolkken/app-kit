import { EnvironmentError } from '#process/environment-error.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { verify_fixture } from './verify-fixture.js'
import { app_verify } from './verify.js'

const { CWD, SUCCESS, E2E_FAILURE, HEADERS_FILE, make_harness } = verify_fixture

afterEach(() => {
	vi.restoreAllMocks()
})

describe('verify — scan turned off by the project (#283)', () => {
	it('runs E2E without the scan or the Docker preflight, even on a header push', async () => {
		const { state, deps } = make_harness({ scan_disabled: true, docker_missing: true })
		const written = vi.spyOn(process.stdout, 'write').mockReturnValue(true)

		const status = await app_verify.run_verify(CWD, [HEADERS_FILE], deps)

		expect(state.order).toEqual(['build', 'boot', 'e2e', 'stop'])
		expect(status).toBe(SUCCESS)
		expect(written).toHaveBeenCalledExactlyOnceWith(`${app_verify.SCAN_DISABLED_MESSAGE}\n`)
	})

	it('names the file and the key in the line it prints', () => {
		expect(app_verify.SCAN_DISABLED_MESSAGE).toContain('verify.dast in josh-app.config.json')
	})

	it('still fails the push when E2E fails', async () => {
		const { deps } = make_harness({ scan_disabled: true, e2e_status: E2E_FAILURE })

		vi.spyOn(process.stdout, 'write').mockReturnValue(true)

		expect(await app_verify.run_verify(CWD, [], deps)).toBe(E2E_FAILURE)
	})
})

describe('verify — push preflight for josh-app start (#283)', () => {
	it('refuses when the scan is on and Docker is missing', () => {
		const { deps } = make_harness({ docker_missing: true })

		expect(() => {
			app_verify.preflight_push(CWD, deps)
		}).toThrow(EnvironmentError)
	})

	it('passes when the scan is on and Docker answers', () => {
		const { state, deps } = make_harness()

		app_verify.preflight_push(CWD, deps)

		expect(state.order).toEqual(['preflight'])
	})

	it('does not ask for Docker when the project turned the scan off', () => {
		const { state, deps } = make_harness({ scan_disabled: true, docker_missing: true })

		app_verify.preflight_push(CWD, deps)

		expect(state.order).toEqual([])
	})
})
