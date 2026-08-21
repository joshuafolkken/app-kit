import { spawnSync } from 'node:child_process'
import { createServer, type Server } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { port_owner } from './port-owner.js'

const PORT = 4173
const OUR_GROUP = 4242
const OTHER_GROUP = 9999
const EPHEMERAL = 0

const state: { server: Server | undefined } = { server: undefined }

// Binds loopback for real: the whole point of this check is that it asks the kernel rather than the
// application, so a fake socket would test nothing.
async function hold_loopback(): Promise<number> {
	return await new Promise<number>((resolve) => {
		const server = createServer()

		state.server = server
		server.listen(
			{ host: port_owner.LOOPBACK_HOST, port: EPHEMERAL },
			function on_listening(): void {
				const address = server.address()

				resolve(typeof address === 'object' && address !== null ? address.port : EPHEMERAL)
			},
		)
	})
}

async function release_loopback(): Promise<void> {
	const { server } = state
	if (server === undefined) return

	state.server = undefined
	await new Promise<void>((resolve) => {
		server.close(() => {
			resolve()
		})
	})
}

afterEach(async () => {
	await release_loopback()
})

describe('loopback occupancy', () => {
	it('reports a port nobody holds as free', async () => {
		const port = await hold_loopback()

		await release_loopback()

		await expect(port_owner.is_port_free(port)).resolves.toBe(true)
	})

	it('reports a port held by a live listener as taken', async () => {
		const port = await hold_loopback()

		await expect(port_owner.is_port_free(port)).resolves.toBe(false)
	})

	// The holder in the incident answered no HTTP at all while it was shutting down. This check sees
	// it because it never asks the application anything.
	it('sees a holder that serves no HTTP', async () => {
		const port = await hold_loopback()

		await expect(port_owner.is_port_free(port)).resolves.toBe(false)
	})
})

describe('ownership decision', () => {
	it('accepts a listener whose process group is the one we spawned', () => {
		expect(port_owner.decide_ownership([OUR_GROUP], OUR_GROUP)).toBe('owned')
	})

	// wrangler's workerd descendant holds the socket, so the listing usually contains other groups
	// alongside ours; finding ours anywhere in it is what counts.
	it('accepts our group even when other listeners share the port listing', () => {
		expect(port_owner.decide_ownership([OTHER_GROUP, OUR_GROUP], OUR_GROUP)).toBe('owned')
	})

	it('rejects a listener from a group we did not spawn', () => {
		expect(port_owner.decide_ownership([OTHER_GROUP], OUR_GROUP)).toBe('foreign')
	})

	// An empty listing means the lookup could not run, which is a fact about the machine. Reading it
	// as "nobody is there" would let a run continue believing it had checked something.
	it('reports an empty listing as unknown rather than foreign', () => {
		expect(port_owner.decide_ownership([], OUR_GROUP)).toBe('unknown')
	})
})

describe('process id parsing', () => {
	it('reads one id per line', () => {
		expect(port_owner.parse_ids('123\n456\n')).toEqual([123, 456])
	})

	// `ps -o pgid=` right-aligns its column, so the padding has to survive the parse.
	it('tolerates the space padding ps emits', () => {
		expect(port_owner.parse_ids('  789\n')).toEqual([789])
	})

	it('drops blank lines and anything that is not a process id', () => {
		expect(port_owner.parse_ids('\nnot-a-pid\n0\n-1\n12\n')).toEqual([12])
	})
})

describe('listener lookup command', () => {
	// The same invocation the occupied-port message tells the user to run, so the machine and the
	// human are looking at one command rather than two that could drift apart.
	it('asks lsof for the listening sockets on the port', () => {
		expect(port_owner.build_lsof_argv(PORT)).toEqual(['-nP', '-iTCP:4173', '-sTCP:LISTEN', '-t'])
	})

	// The hint and the lookup must select the same sockets, or the reader is sent after a different
	// set of processes than the one this module just judged.
	it('tells the user to run the same selection the lookup used', () => {
		const flags = port_owner.build_lookup_flags(PORT).join(' ')

		expect(port_owner.build_held_message(PORT)).toContain(flags)
	})

	// The property that must hold on every machine, with or without lsof: a run may fail to confirm
	// ownership, but it must never claim ownership it did not establish.
	it('never claims a live foreign listener as ours', async () => {
		const port = await hold_loopback()

		expect(port_owner.check_ownership(port, OTHER_GROUP)).not.toBe('owned')
	})
})

// Derives the expected answer by a route that does NOT go through the module: if the lookup chain is
// wired wrongly, the two disagree. `undefined` means this machine cannot answer the question at all,
// which the module must then report as 'unknown' rather than inventing a verdict.
// An absolute path rather than a PATH lookup: the test only needs a second opinion, and taking it
// from a fixed location keeps this file free of the ambient-PATH question the production lookup has
// to live with.
const PS_BINARY = '/bin/ps'

function read_own_group_id(): number | undefined {
	const result = spawnSync(PS_BINARY, ['-o', 'pgid=', '-p', String(process.pid)], {
		encoding: 'utf8',
	})
	if (result.error !== undefined || result.status !== 0) return undefined

	const parsed = Number(result.stdout.trim())

	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined
}

describe('ownership of a live socket', () => {
	// The end-to-end chain — lsof finds the listener, ps maps it to a group, the decision compares it.
	// The unit tests above cover each link; only this one proves they are joined correctly.
	it('recognizes a socket this process holds as ours', async () => {
		const port = await hold_loopback()
		const expected = read_own_group_id()

		expect(port_owner.check_ownership(port, expected ?? OUR_GROUP)).toBe(
			expected === undefined ? 'unknown' : 'owned',
		)
	})

	// The listener is this test process, whose group is not OTHER_GROUP — so a machine that CAN look
	// it up must say so, and one that cannot must say it cannot.
	it('reports a foreign group as foreign wherever the lookup works', async () => {
		const port = await hold_loopback()
		const expected = read_own_group_id()

		expect(port_owner.check_ownership(port, OTHER_GROUP)).toBe(
			expected === undefined ? 'unknown' : 'foreign',
		)
	})
})

describe('port failure messages', () => {
	it('tells the reader how to find the process holding the port', () => {
		expect(port_owner.build_held_message(PORT)).toContain('lsof -nP -iTCP:4173 -sTCP:LISTEN')
	})

	// A run that has just been told the port answers nothing needs to know this verdict came from the
	// kernel, or the message reads as a contradiction.
	it('explains that a silent holder still owns the socket', () => {
		expect(port_owner.build_held_message(PORT)).toContain('nothing answers HTTP there')
	})

	it('distinguishes a late arrival from a port that was busy all along', () => {
		expect(port_owner.build_foreign_message('http://127.0.0.1:4173/', PORT)).toContain(
			'was free at startup',
		)
	})

	// Not a failure message: it has to say what is still guaranteed, or a warning on an ordinary
	// green run reads as something being wrong.
	it('states what remains verified when the lookup is unavailable', () => {
		expect(port_owner.build_unverified_message(PORT)).toContain(
			'verified free before the server was started',
		)
	})

	it('names the tool that was missing rather than reporting a generic failure', () => {
		expect(port_owner.build_unverified_message(PORT)).toContain('lsof')
	})
})
