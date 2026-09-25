import { LANE_SEAT_KEY, PORT_SEED_KEY } from '@joshuafolkken/kit/ports'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { port_seed_fixture } from './port-seed-fixture.js'

afterEach(() => vi.unstubAllEnvs())

describe('port seed fixture', () => {
	it('clears and restores the seed and lane seat', () => {
		vi.stubEnv(PORT_SEED_KEY, '2')
		vi.stubEnv(LANE_SEAT_KEY, '3')
		const isolation = port_seed_fixture.isolate()

		isolation.clear()
		expect(process.env[PORT_SEED_KEY]).toBeUndefined()
		expect(process.env[LANE_SEAT_KEY]).toBeUndefined()

		isolation.restore()
		expect(process.env[PORT_SEED_KEY]).toBe('2')
		expect(process.env[LANE_SEAT_KEY]).toBe('3')
	})
})
