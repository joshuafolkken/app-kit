import { existsSync } from 'node:fs'
import path from 'node:path'
import { preview_port } from '#dast/preview-port.js'
import { preview_server, type PreviewHandle } from '#dast/preview.js'
import { EnvironmentError } from '#process/environment-error.js'
import { process_runner, type CommandRunner } from '#process/runner.js'
import { k6 } from './k6.js'

// `josh-app load`: build the app, boot the preview server, run the k6 load-test scenario against
// it, and tear the server down — including on failure. Report-only by default: the seeded scenario
// defines no failing thresholds, so k6 exits 0 and the command surfaces latency/throughput numbers
// without gating a push on an uncalibrated baseline. Deliberately NOT a lefthook hook (app-kit#95).
//
// The preview port is resolved through preview_port, kit's single definition — the same number
// playwright.config.ts, the DAST scan and the distributed `preview` script derive (app-kit#177).
// The preview boot/teardown is preview_server (single-sourced with dast/verify), not re-derived.

// The default scenario `josh-app sync` seeds and `josh-app load` runs when given no argument. A
// path relative to the project root, so the same default resolves in app-kit and every consumer.
// `josh-app load <path>` overrides it with any scenario of yours.
const SCENARIO_FILE = path.join('k6', 'load-test.js')

// The "attacking" throughput-ceiling scenario, run by the dedicated `josh-app load:stress` command
// (equivalent to `josh-app load k6/stress-test.js`, kept as a first-class command for discovery).
const STRESS_SCENARIO_FILE = path.join('k6', 'stress-test.js')

const SUCCESS = process_runner.SUCCESS_STATUS

const K6_UNAVAILABLE_MESSAGE = [
	'josh-app load requires the k6 load-testing tool on PATH.',
	'Install it — https://grafana.com/docs/k6/latest/set-up/install-k6/ (e.g. `brew install k6`) — and re-run.',
].join('\n')

function scenario_missing_message(scenario: string): string {
	return [
		`josh-app load could not find the k6 scenario at ${scenario}.`,
		'Run `josh-app sync` to seed it (or create it yourself).',
	].join('\n')
}

interface LoadDependencies {
	k6_run: CommandRunner
	pnpm: CommandRunner
	start_preview: (cwd: string, port: number) => Promise<PreviewHandle>
	has_scenario: (cwd: string, scenario: string) => boolean
}

function default_k6(argv: ReadonlyArray<string>, cwd: string): ReturnType<CommandRunner> {
	return process_runner.run_command(k6.K6_BIN, argv, cwd)
}

function has_scenario_file(cwd: string, scenario: string): boolean {
	return existsSync(path.join(cwd, scenario))
}

const DEFAULT_DEPENDENCIES: LoadDependencies = {
	k6_run: default_k6,
	pnpm: process_runner.run_pnpm,
	start_preview: preview_server.start_preview,
	has_scenario: has_scenario_file,
}

// `k6 version` fails both when the CLI is absent (spawn error) and when it exits non-zero; both are
// the same actionable "install k6" condition. Reports whether k6 can run.
function is_k6_available(deps: LoadDependencies, cwd: string): boolean {
	const outcome = deps.k6_run(k6.PREFLIGHT_ARGV, cwd)

	return outcome.error === undefined && outcome.status === SUCCESS
}

// Preflight the fixable prerequisites (k6 installed, scenario present) before any expensive work.
// Raises the same typed error dast uses, so the CLI prints a plain actionable line and never a
// stack trace for a condition the user can fix.
function assert_prerequisites(deps: LoadDependencies, cwd: string, scenario: string): void {
	if (!is_k6_available(deps, cwd)) throw new EnvironmentError(K6_UNAVAILABLE_MESSAGE)

	if (!deps.has_scenario(cwd, scenario)) {
		throw new EnvironmentError(scenario_missing_message(scenario))
	}
}

// Run the scenario against a server ALREADY LISTENING on `port` — no build, no preview lifecycle.
// Kept a pure "load a running server" primitive so the lifecycle stays in run_load.
function load_running_server(
	cwd: string,
	port: number,
	scenario: string,
	deps: LoadDependencies,
): number {
	return process_runner.to_exit_status(deps.k6_run(k6.build_run_argv(scenario, port), cwd))
}

// The k6 summary already prints the numbers; an explicit closing line makes the outcome
// unambiguous rather than leaving the reader to interpret whatever printed last.
function describe_result(status: number): string {
	if (status === SUCCESS) {
		return '✅ josh-app load: scenario completed — see the k6 summary above for latency and throughput.'
	}

	return `❌ josh-app load: k6 exited with status ${String(status)} — see the summary above.`
}

// Standalone `josh-app load [scenario]`: preflight k6 + the scenario, build, boot the preview it
// owns, run k6 against it, tear it down. `scenario` defaults to the seeded baseline; pass a path
// (e.g. k6/stress-test.js) to run a different one. Returns k6's exit status (report-only → 0).
async function run_load(
	cwd: string,
	scenario: string = SCENARIO_FILE,
	deps: LoadDependencies = DEFAULT_DEPENDENCIES,
): Promise<number> {
	assert_prerequisites(deps, cwd, scenario)

	// Resolved before the build for the same reason the k6 preflight runs there: a malformed
	// PORT_SEED throws, and discovering that after a full build wastes the whole build.
	const port = preview_port.resolve(cwd)

	const build_status = process_runner.to_exit_status(deps.pnpm(process_runner.BUILD_ARGV, cwd))
	if (build_status !== SUCCESS) return build_status

	const server = await deps.start_preview(cwd, port)

	try {
		return load_running_server(cwd, port, scenario, deps)
	} finally {
		server.stop()
	}
}

const app_load = { SCENARIO_FILE, STRESS_SCENARIO_FILE, describe_result, run_load }

export { app_load }
export type { LoadDependencies }
