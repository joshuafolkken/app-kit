import { describe, expect, it } from 'vitest'
import { preview_release, type ReleaseDependencies } from './preview-release.js'

const PORT = 4173
const TICK_MS = 100

interface ReleaseState {
	checks: number
	clock: number
}

function make_deps(
	state: ReleaseState,
	release_after: number,
	answer_until = 0,
): ReleaseDependencies {
	return {
		async is_port_free(): Promise<boolean> {
			state.checks += 1

			return state.checks >= release_after
		},
		async probe(): Promise<boolean> {
			return state.checks < answer_until
		},
		async sleep(ms: number): Promise<void> {
			state.clock += ms
		},
		now(): number {
			return state.clock
		},
	}
}

describe('preview port release', () => {
	it('waits for a delayed release before returning', async () => {
		const state = { checks: 0, clock: 0 }

		await preview_release.wait_for_release(PORT, make_deps(state, 3))

		expect(state.checks).toBe(3)
		expect(state.clock).toBe(TICK_MS * 2)
	})

	it('waits while the old wildcard listener still answers HTTP', async () => {
		const state = { checks: 0, clock: 0 }

		await preview_release.wait_for_release(PORT, make_deps(state, 1, 3))

		expect(state.checks).toBe(3)
	})

	it('fails when a stopped preview keeps holding the port', async () => {
		const state = { checks: 0, clock: 0 }

		const release = preview_release.wait_for_release(PORT, make_deps(state, Infinity))

		await expect(release).rejects.toThrow('was not released')
	})
})
