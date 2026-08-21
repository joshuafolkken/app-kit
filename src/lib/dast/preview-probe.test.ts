import { createServer, type Server, type Socket } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { preview_server } from './preview.js'

const READY_TIMEOUT_MS = 120_000
const PROBE_TEST_TIMEOUT_MS = 20_000

const state: { server: Server | undefined; sockets: Array<Socket> } = {
	server: undefined,
	sockets: [],
}

// `close` waits for open connections, and the aborted probe leaves one behind — so the sockets have
// to be destroyed first or the teardown hangs on the very condition under test.
afterEach(async () => {
	const { server, sockets } = state

	state.server = undefined
	state.sockets = []
	for (const socket of sockets) socket.destroy()
	if (server === undefined) return

	await new Promise<void>((resolve) => {
		server.close(() => {
			resolve()
		})
	})
})

// Accepts the socket and writes nothing, ever.
async function hold_silently(): Promise<number> {
	return await new Promise<number>((resolve) => {
		const server = createServer()

		state.server = server
		server.on('connection', function on_connection(socket: Socket): void {
			state.sockets.push(socket)
		})

		server.listen({ host: '127.0.0.1', port: 0 }, function on_listening(): void {
			const address = server.address()

			resolve(typeof address === 'object' && address !== null ? address.port : 0)
		})
	})
}

// The probe runs before the readiness deadline exists, so nothing else bounds it. A holder that
// accepts the connection and never answers — a wrangler mid-restart is one — would otherwise leave
// the pre-push hook waiting with no output and no end.
describe('preview server readiness probe is bounded', () => {
	it(
		'gives up on a connection that is accepted but never answered',
		async () => {
			const port = await hold_silently()

			await expect(
				preview_server.default_probe(preview_server.build_probe_url(port)),
			).resolves.toBe(false)
		},
		PROBE_TEST_TIMEOUT_MS,
	)

	it('bounds the wait well under the readiness deadline', () => {
		expect(preview_server.PROBE_TIMEOUT_MS).toBeLessThan(READY_TIMEOUT_MS)
	})
})
