import { describe, expect, it } from 'vitest'
import { zap } from './zap.js'

const CWD = '/consumer/project'
const PORT = 4173

const CONFIG_FILE = 'zap-baseline.conf'

// No default parameter here: `scan_argv(undefined)` must reach build_scan_argv as undefined, and
// a default would silently substitute the config back in — testing the wrong branch.
function scan_argv(config: string | undefined): ReadonlyArray<string> {
	return zap.build_scan_argv(CWD, PORT, config)
}

function configured_argv(): ReadonlyArray<string> {
	return scan_argv(CONFIG_FILE)
}

describe('ZAP baseline docker argv', () => {
	it('runs the ZAP baseline script in a disposable container', () => {
		const argv = configured_argv()

		expect(argv.slice(0, 2)).toEqual(['run', '--rm'])
		expect(argv).toContain('ghcr.io/zaproxy/zaproxy:stable')
		expect(argv).toContain('zap-baseline.py')
	})

	it('maps host.docker.internal so the container can reach the host preview on Linux/CI', () => {
		expect(configured_argv()).toContain('host.docker.internal:host-gateway')
	})

	it('mounts the project at the working directory zap-baseline.py reads its config from', () => {
		expect(configured_argv()).toContain(`${CWD}:/zap/wrk:rw`)
	})

	it('targets the preview server through the host alias, not loopback', () => {
		const argv = configured_argv()
		const target = argv[argv.indexOf('-t') + 1]

		// Loopback inside the container is the container itself — the scan would find nothing.
		// eslint-disable-next-line unicorn/prefer-https -- a local preview server is plain HTTP
		expect(target).toBe('http://host.docker.internal:4173')
		expect(target).not.toContain('127.0.0.1')
		expect(target).not.toContain('localhost')
	})

	it('passes the baseline config when the project has one', () => {
		const argv = configured_argv()

		expect(argv[argv.indexOf('-c') + 1]).toBe(CONFIG_FILE)
	})

	it('omits -c entirely when no config exists, rather than pointing at a missing file', () => {
		// A `-c` path ZAP cannot read makes it exit 3 (error), which reads as a broken scan
		// rather than the "no triage file yet" state it actually is.
		expect(scan_argv(undefined)).not.toContain('-c')
	})

	it('probes the daemon, not just the CLI, during preflight', () => {
		// `docker --version` succeeds with the daemon stopped; `docker info` does not.
		expect(zap.PREFLIGHT_ARGV).toEqual(['info'])
	})
})
