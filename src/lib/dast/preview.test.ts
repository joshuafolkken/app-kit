import { describe, expect, it } from 'vitest'
import { preview_server, type PreviewDependencies, type PreviewHandle } from './preview.js'

const CWD = '/consumer/project'
const PORT = 4173
const TICK_MS = 500
const READY_TIMEOUT_MS = 120_000

interface Harness {
	deps: PreviewDependencies
	stop_count: () => number
	probe_count: () => number
}

// A fake clock advanced by sleep(), so a timeout is exercised without a real 2-minute wait.
function make_harness(ready_after_probes: number, server_output = ''): Harness {
	let stops = 0
	let probes = 0
	let clock = 0

	function stop(): void {
		stops += 1
	}

	function output(): string {
		return server_output
	}

	function start(): PreviewHandle {
		return { stop, output }
	}

	async function probe(): Promise<boolean> {
		probes += 1

		return probes >= ready_after_probes
	}

	async function sleep(ms: number): Promise<void> {
		clock += ms
	}

	function now(): number {
		return clock
	}

	return {
		deps: { start, probe, sleep, now },
		stop_count: () => stops,
		probe_count: () => probes,
	}
}

// Never becomes ready, so the deadline is the only way out.
const NEVER_READY = Number.MAX_SAFE_INTEGER

describe('preview server lifecycle', () => {
	it('resolves as soon as the server answers', async () => {
		const harness = make_harness(1)

		await expect(preview_server.start_preview(CWD, PORT, harness.deps)).resolves.toBeDefined()
		expect(harness.probe_count()).toBe(1)
	})

	it('keeps polling while the server is still booting', async () => {
		const harness = make_harness(4)

		await preview_server.start_preview(CWD, PORT, harness.deps)

		expect(harness.probe_count()).toBe(4)
	})

	it('does not tear down a server that came up', async () => {
		const harness = make_harness(2)

		await preview_server.start_preview(CWD, PORT, harness.deps)

		expect(harness.stop_count()).toBe(0)
	})
})

describe('preview server readiness timeout', () => {
	it('gives up once the readiness deadline passes', async () => {
		const harness = make_harness(NEVER_READY)

		await expect(preview_server.start_preview(CWD, PORT, harness.deps)).rejects.toThrow(
			/did not become ready/u,
		)
	})

	it('tears down a server that never became ready instead of leaking the port', async () => {
		const harness = make_harness(NEVER_READY)

		await expect(preview_server.start_preview(CWD, PORT, harness.deps)).rejects.toThrow()
		expect(harness.stop_count()).toBe(1)
	})

	it('surfaces the server output when the boot fails, so the cause is visible', async () => {
		// Piping the server's stdio keeps its routine shutdown noise off the terminal; a failed
		// boot is the one time that buffer is what actually explains the failure.
		const harness = make_harness(NEVER_READY, 'Error: Address already in use (port 4173)')

		await expect(preview_server.start_preview(CWD, PORT, harness.deps)).rejects.toThrow(
			/Address already in use/u,
		)
	})

	it('bounds the boot wait rather than polling forever', async () => {
		const harness = make_harness(NEVER_READY)

		await expect(preview_server.start_preview(CWD, PORT, harness.deps)).rejects.toThrow()
		expect(harness.probe_count()).toBeLessThanOrEqual(READY_TIMEOUT_MS / TICK_MS + 1)
	})

	it('probes loopback on the host, where the preview listener actually is', () => {
		expect(preview_server.build_probe_url(PORT)).toBe('http://127.0.0.1:4173/')
	})

	it('binds the preview to all interfaces so the scanner container can reach it', () => {
		// wrangler binds loopback-only by default, which host-gateway traffic cannot reach.
		expect(preview_server.PREVIEW_ARGV).toEqual(['run', 'preview', '--ip', '0.0.0.0'])
	})
})

// Fires each handler as it registers, so one call exercises the whole teardown path.
function fire_on_register(_signal: NodeJS.Signals, handler: () => void): void {
	handler()
}

describe('preview server signal teardown', () => {
	// A detached child sits in its own process group, so Ctrl-C never reaches it. Dropping any of
	// these signals leaves wrangler orphaned on port 4173 after an interrupted scan.
	const state = { stops: 0, raised: [] as Array<NodeJS.Signals> }

	function stop(): void {
		state.stops += 1
	}

	function raise(signal: NodeJS.Signals): void {
		state.raised.push(signal)
	}

	it('stops the server and re-raises on every interrupt signal', () => {
		preview_server.register_teardown(stop, fire_on_register, raise)

		expect(state.raised).toContain('SIGINT')
		expect(state.raised).toContain('SIGTERM')
		expect(state.stops).toBe(preview_server.TEARDOWN_SIGNALS.length)
	})
})
