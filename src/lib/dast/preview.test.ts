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
	start_count: () => number
}

interface HarnessOptions {
	// How many probes the fake server needs before it answers. The FIRST probe is the pre-spawn
	// occupancy check, so a server that boots normally must not answer it — hence `ready_after_probes`
	// of 2 or more everywhere except the occupied case.
	ready_after_probes: number
	server_output?: string
	// After how many probes the spawned process dies, standing in for a wrangler that cannot bind.
	exits_after_probes?: number
}

const NEVER = Number.MAX_SAFE_INTEGER

// A fake clock advanced by sleep(), so a timeout is exercised without a real 2-minute wait.
function make_harness(options: HarnessOptions): Harness {
	const counts = { stops: 0, probes: 0, starts: 0, clock: 0 }
	const { exits_after_probes = NEVER, server_output = '' } = options

	function stop(): void {
		counts.stops += 1
	}

	function start(): PreviewHandle {
		counts.starts += 1

		return {
			stop,
			output: () => server_output,
			has_exited: () => counts.probes >= exits_after_probes,
		}
	}

	async function probe(): Promise<boolean> {
		counts.probes += 1

		return counts.probes >= options.ready_after_probes
	}

	async function sleep(ms: number): Promise<void> {
		counts.clock += ms
	}

	return {
		deps: { start, probe, sleep, now: () => counts.clock },
		stop_count: () => counts.stops,
		probe_count: () => counts.probes,
		start_count: () => counts.starts,
	}
}

function harness_ready_after(probes: number, server_output = ''): Harness {
	return make_harness({ ready_after_probes: probes, server_output })
}

// Never becomes ready, so the deadline is the only way out.
const NEVER_READY = Number.MAX_SAFE_INTEGER

// The pre-spawn occupancy check spends the first probe, so a free port needs the SECOND probe to be
// the one that answers.
const READY_ON_BOOT = 2

const PROBE_URL = 'http://127.0.0.1:4173/'

function occupied_message(): string {
	return preview_server.build_occupied_message(preview_server.build_probe_url(PORT), PORT)
}

describe('preview server lifecycle', () => {
	it('resolves as soon as the server answers', async () => {
		const harness = harness_ready_after(READY_ON_BOOT)

		await expect(preview_server.start_preview(CWD, PORT, harness.deps)).resolves.toBeDefined()
		expect(harness.probe_count()).toBe(READY_ON_BOOT)
	})

	it('keeps polling while the server is still booting', async () => {
		const harness = harness_ready_after(5)

		await preview_server.start_preview(CWD, PORT, harness.deps)

		expect(harness.probe_count()).toBe(5)
	})

	it('does not tear down a server that came up', async () => {
		const harness = harness_ready_after(3)

		await preview_server.start_preview(CWD, PORT, harness.deps)

		expect(harness.stop_count()).toBe(0)
	})

	it('spawns exactly one server on a free port', async () => {
		const harness = harness_ready_after(READY_ON_BOOT)

		await preview_server.start_preview(CWD, PORT, harness.deps)

		expect(harness.start_count()).toBe(1)
	})
})

// app-kit#136: the readiness probe accepted ANY answer on the port, so another project's preview
// already listening on 4173 was adopted as "ready" — Playwright and the ZAP scan then checked that
// foreign app while app-kit's own wrangler, unable to bind, went unheard. Running the readiness
// condition BEFORE the spawn is what makes a later "it answered" mean anything.
describe('preview server refuses a server it did not start', () => {
	// The whole incident in one case: something already answers on the port.
	it('fails instead of adopting a listener that is already answering', async () => {
		const harness = harness_ready_after(1)

		await expect(preview_server.start_preview(CWD, PORT, harness.deps)).rejects.toThrow(
			/held by a server josh-app did not start/u,
		)
	})

	it('never spawns onto an occupied port', async () => {
		const harness = harness_ready_after(1)

		await expect(preview_server.start_preview(CWD, PORT, harness.deps)).rejects.toThrow()
		expect(harness.start_count()).toBe(0)
	})

	it('names the port, the probe URL, and how to identify the process holding it', () => {
		expect(occupied_message()).toContain(PROBE_URL)
		expect(occupied_message()).toContain('lsof -nP -iTCP:4173 -sTCP:LISTEN')
	})

	it('points at the orphaned-wrangler case, the other way this port gets held', () => {
		expect(occupied_message()).toContain('pkill -f')
	})
})

// The residual race the pre-spawn check cannot close: a process takes the port in the gap, so OUR
// wrangler is the one that fails to bind. Its exit used to be invisible — the loop kept polling and
// the captured bind error only ever surfaced on a timeout that, with a squatter answering, never came.
describe('preview server reports a spawn that died', () => {
	it('fails as soon as the spawned server exits, without waiting out the deadline', async () => {
		const harness = make_harness({ ready_after_probes: NEVER_READY, exits_after_probes: 3 })

		await expect(preview_server.start_preview(CWD, PORT, harness.deps)).rejects.toThrow(
			/exited before answering/u,
		)
		expect(harness.probe_count()).toBe(3)
	})

	it('surfaces the captured output of a server that could not bind', async () => {
		const harness = make_harness({
			ready_after_probes: NEVER_READY,
			exits_after_probes: READY_ON_BOOT,
			server_output: 'Error: Address already in use (port 4173)',
		})

		await expect(preview_server.start_preview(CWD, PORT, harness.deps)).rejects.toThrow(
			/Address already in use/u,
		)
	})

	it('tears down the dead spawn rather than leaking its handle', async () => {
		const harness = make_harness({
			ready_after_probes: NEVER_READY,
			exits_after_probes: READY_ON_BOOT,
		})

		await expect(preview_server.start_preview(CWD, PORT, harness.deps)).rejects.toThrow()
		expect(harness.stop_count()).toBe(1)
	})
})

describe('preview server readiness timeout', () => {
	it('gives up once the readiness deadline passes', async () => {
		const harness = harness_ready_after(NEVER_READY)

		await expect(preview_server.start_preview(CWD, PORT, harness.deps)).rejects.toThrow(
			/did not become ready/u,
		)
	})

	it('tears down a server that never became ready instead of leaking the port', async () => {
		const harness = harness_ready_after(NEVER_READY)

		await expect(preview_server.start_preview(CWD, PORT, harness.deps)).rejects.toThrow()
		expect(harness.stop_count()).toBe(1)
	})

	it('surfaces the server output when the boot fails, so the cause is visible', async () => {
		// Piping the server's stdio keeps its routine shutdown noise off the terminal; a failed
		// boot is the one time that buffer is what actually explains the failure.
		const harness = harness_ready_after(NEVER_READY, 'Error: boot failed after 90s')

		await expect(preview_server.start_preview(CWD, PORT, harness.deps)).rejects.toThrow(
			/boot failed after 90s/u,
		)
	})

	it('bounds the boot wait rather than polling forever', async () => {
		const harness = harness_ready_after(NEVER_READY)

		await expect(preview_server.start_preview(CWD, PORT, harness.deps)).rejects.toThrow()
		expect(harness.probe_count()).toBeLessThanOrEqual(READY_TIMEOUT_MS / TICK_MS + 1)
	})

	it('probes loopback on the host, where the preview listener actually is', () => {
		expect(preview_server.build_probe_url(PORT)).toBe(PROBE_URL)
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
