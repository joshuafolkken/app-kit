import { port_owner } from './port-owner.js'
import { preview_server } from './preview.js'

const RELEASE_TIMEOUT_MS = 5000
const RELEASE_POLL_MS = 100

interface ReleaseDependencies {
	is_port_free: (port: number) => Promise<boolean>
	probe: (url: string) => Promise<boolean>
	sleep: (ms: number) => Promise<void>
	now: () => number
}

async function sleep(ms: number): Promise<void> {
	await new Promise<void>(function wait(resolve): void {
		setTimeout(resolve, ms)
	})
}

const DEFAULT_DEPENDENCIES: ReleaseDependencies = {
	is_port_free: port_owner.is_port_free,
	probe: preview_server.default_probe,
	sleep,
	now: Date.now,
}

async function wait_for_release(
	port: number,
	deps: ReleaseDependencies = DEFAULT_DEPENDENCIES,
): Promise<void> {
	const deadline = deps.now() + RELEASE_TIMEOUT_MS
	const url = preview_server.build_probe_url(port)

	while (deps.now() < deadline) {
		if ((await deps.is_port_free(port)) && !(await deps.probe(url))) return

		await deps.sleep(RELEASE_POLL_MS)
	}

	throw new Error(`Preview port ${String(port)} was not released after stopping the server`)
}

const preview_release = { wait_for_release }

export { preview_release }
export type { ReleaseDependencies }
