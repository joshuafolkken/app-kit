import { mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { preview_port } from '#dast/preview-port.js'
import { preview_server, type PreviewHandle } from '#dast/preview.js'
import { process_runner } from '#process/runner.js'
import { capture, type CaptureOutcome, type ShotBrowser } from './capture.js'
import { shot_routes, type ShotPlan, type ShotRequest } from './routes.js'

// `josh-app shot <route...>`: build the app ONCE, boot the preview server ONCE, drive a real
// browser over every requested route, write the PNGs to a fixed directory, and tear the server down
// — including on failure. It exists so the completion gate's "look at the rendered result"
// requirement has a mechanism behind it instead of only a rule (app-kit #200); the `/verify` skill
// that consumes it is kit#853.
//
// The lifecycle is deliberately the one `verify`, `dast` and `load` already use — preview_port for
// the number, preview_server for the boot/teardown — rather than a fourth private copy.

const SUCCESS = process_runner.SUCCESS_STATUS
const CAPTURE_FAILURE_STATUS = 1

interface ShotDependencies {
	preflight_playwright: (cwd: string) => void
	prepare_output: (cwd: string, files: ReadonlyArray<string>) => void
	build: (cwd: string) => number
	start_preview: (cwd: string, port: number) => Promise<PreviewHandle>
	launch: (cwd: string) => Promise<ShotBrowser>
}

function default_preflight_playwright(cwd: string): void {
	capture.resolve_playwright_entry(cwd)
}

// Exactly the files this run will write are removed, and nothing else. Removing them matters: a
// route that fails writes no image, and a stale PNG of the same route from an earlier run would sit
// there looking current. Removing only them matters just as much — the whole directory is shared
// with the other viewport, so wiping it would make the `-mobile` suffix pointless and stop a
// desktop run and a mobile run from ever coexisting.
function default_prepare_output(cwd: string, files: ReadonlyArray<string>): void {
	mkdirSync(path.join(cwd, shot_routes.OUTPUT_DIR), { recursive: true })

	for (const file of files) {
		rmSync(file, { force: true })
	}
}

const DEFAULT_DEPENDENCIES: ShotDependencies = {
	preflight_playwright: default_preflight_playwright,
	prepare_output: default_prepare_output,
	build: process_runner.run_build,
	start_preview: preview_server.start_preview,
	launch: capture.default_launch,
}

// The plan carries project-relative paths because that is what a report should print; the browser
// needs a path it can write from wherever the process happens to be.
function to_absolute(cwd: string, request: ShotRequest): ShotRequest {
	return { route: request.route, file: path.join(cwd, request.file) }
}

// Sequential rather than concurrent: the routes share one preview server and one browser, and a
// handful of page loads is not worth the interleaved failure reporting that parallel capture buys.
async function capture_all(
	browser: ShotBrowser,
	plan: ShotPlan,
	port: number,
	cwd: string,
): Promise<Array<CaptureOutcome>> {
	const outcomes: Array<CaptureOutcome> = []

	for (const request of plan.requests) {
		const absolute = to_absolute(cwd, request)

		outcomes.push(await capture.capture_one(browser, plan.viewport, port, absolute))
	}

	return outcomes
}

async function capture_with_browser(
	plan: ShotPlan,
	port: number,
	cwd: string,
	deps: ShotDependencies,
): Promise<Array<CaptureOutcome>> {
	const browser = await deps.launch(cwd)

	try {
		return await capture_all(browser, plan, port, cwd)
	} finally {
		await browser.close()
	}
}

function describe_outcome(outcome: CaptureOutcome): string {
	if (capture.is_capture_ok(outcome)) return `  ✅ ${outcome.route} → ${outcome.file}`

	return `  ❌ ${outcome.route} → HTTP ${String(outcome.status)} (no screenshot written)`
}

// Every route is listed, passing or not, so the reader sees exactly which files exist. A non-2xx/3xx
// route fails the command: a screenshot run that quietly produced a picture of the 404 page — or no
// picture at all — and exited 0 is the silent success this command exists to remove.
function describe_result(outcomes: ReadonlyArray<CaptureOutcome>): string {
	const lines = outcomes.map((outcome) => describe_outcome(outcome))
	const failures = outcomes.filter((outcome) => !capture.is_capture_ok(outcome)).length

	const header =
		failures === 0
			? `✅ josh-app shot: captured ${String(outcomes.length)} route(s) into ${shot_routes.OUTPUT_DIR}/.`
			: `❌ josh-app shot: ${String(failures)} of ${String(outcomes.length)} route(s) failed.`

	return [header, ...lines].join('\n')
}

function to_status(outcomes: ReadonlyArray<CaptureOutcome>): number {
	const is_complete = outcomes.every((outcome) => capture.is_capture_ok(outcome))

	return is_complete ? SUCCESS : CAPTURE_FAILURE_STATUS
}

interface ShotResult {
	status: number
	outcomes: ReadonlyArray<CaptureOutcome>
}

const BUILD_FAILED: ReadonlyArray<CaptureOutcome> = []

// Boot the one server, capture against it, tear it down — always, including when a capture throws.
async function run_against_server(
	plan: ShotPlan,
	port: number,
	cwd: string,
	deps: ShotDependencies,
): Promise<Array<CaptureOutcome>> {
	const server = await deps.start_preview(cwd, port)

	try {
		return await capture_with_browser(plan, port, cwd, deps)
	} finally {
		server.stop()
	}
}

// `argv` is the raw trailing command line (routes plus an optional `--mobile`). Parsing lives in
// routes.ts and throws on an empty or relative route list, before anything expensive starts.
async function run_shot(
	cwd: string,
	argv: ReadonlyArray<string>,
	deps: ShotDependencies = DEFAULT_DEPENDENCIES,
): Promise<ShotResult> {
	const plan = shot_routes.build_plan(argv)

	// Fail fast on a project without Playwright before the build: discovering it afterwards wastes
	// the whole build, the same reason `dast` preflights Docker and `load` preflights k6 up front.
	deps.preflight_playwright(cwd)

	// Resolved alongside that preflight so a malformed PORT_SEED also throws before the build.
	const port = preview_port.resolve(cwd)

	const build_status = deps.build(cwd)
	if (build_status !== SUCCESS) return { status: build_status, outcomes: BUILD_FAILED }

	deps.prepare_output(
		cwd,
		plan.requests.map((request) => to_absolute(cwd, request).file),
	)

	const outcomes = await run_against_server(plan, port, cwd, deps)

	return { status: to_status(outcomes), outcomes }
}

const app_shot = {
	CAPTURE_FAILURE_STATUS,
	describe_result,
	to_status,
	run_shot,
}

export { app_shot }
export type { ShotDependencies, ShotResult }
