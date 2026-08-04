// Argv builders for the k6 load-test runner. Pure string assembly, kept separate from the
// orchestration in load.ts so the exact shipped command line is unit-testable without k6 installed
// — the same split dast.ts/zap.ts uses for the ZAP command line.
const K6_BIN = 'k6'

// The scenario reads its target from __ENV.BASE_URL, so one scenario file works against whatever
// host/port the runner points it at (the preview server here; a staging URL for a consumer).
const BASE_URL_ENV = 'BASE_URL'

// Loopback: k6 runs as a local process against the preview server on the same host — no container,
// so none of the ZAP scan's host-gateway indirection is needed.
const PROBE_HOST = '127.0.0.1'

// `k6 version` proves the binary is installed and runnable — the preflight. Distinct from the run
// so a missing k6 fails with an actionable message before the build + preview boot happen.
const PREFLIGHT_ARGV: ReadonlyArray<string> = ['version']

function build_target_url(port: number): string {
	return `http://${PROBE_HOST}:${String(port)}`
}

// `k6 run --env BASE_URL=<url> <scenario>`: the scenario path is passed last, the target handed in
// as an env var the scenario reads. No thresholds are forced here — report-only is the scenario's
// own choice (app-kit#95), so k6's exit status passes through untouched.
function build_run_argv(scenario: string, port: number): ReadonlyArray<string> {
	return ['run', '--env', `${BASE_URL_ENV}=${build_target_url(port)}`, scenario]
}

const k6 = { K6_BIN, BASE_URL_ENV, PREFLIGHT_ARGV, build_target_url, build_run_argv }

export { k6 }
