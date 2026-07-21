import path from 'node:path'
import { app_dast } from '#dast/dast.js'
import { preview_server, type PreviewHandle } from '#dast/preview.js'
import { process_runner } from '#process/runner.js'

// `josh-app verify`: the unified pre-push runtime gate. It builds ONCE, boots the preview server
// ONCE, then runs the E2E suite and the ZAP baseline scan against that single running server, and
// tears it down — including on failure. Before this, the pre-push `test-e2e` and `dast` commands
// each built and booted their own preview (duplicate work serially, a port/build collision in
// parallel). Here both checks are just HTTP clients against one server, so build-once and a single
// port fall out for free. See app-kit #97.
//
// Port 4173 is the preview server's own port, shared with playwright.config.ts and the scan.
const { PREVIEW_PORT } = app_dast

const BUILD_ARGV: ReadonlyArray<string> = ['run', 'build']

// Delegate E2E to kit's guarded runner (`josh test:e2e` → skips cleanly when Playwright or the
// e2e suite is absent) rather than reimplementing the guard. The env makes Playwright reuse the
// server this command already booted: PLAYWRIGHT_REUSE_SERVER=1 flips reuseExistingServer on in
// the kit-distributed playwright.config (kit#673), so Playwright skips its own build+boot.
const E2E_ARGV: ReadonlyArray<string> = ['josh', 'test:e2e']
const E2E_ENV: Readonly<Record<string, string>> = {
	CI: '1',
	PLAYWRIGHT_HTML_OPEN: 'never',
	PLAYWRIGHT_REUSE_SERVER: '1',
}

// The files that can change a ZAP baseline verdict — response headers and cookie attributes. Kept
// in lockstep with the DAST glob in lefthook/sveltekit.yml (see #94). A change to anything else
// (a component, a lib function) cannot alter the scan result, so the ~34s scan is skipped for it.
const HEADER_ROUTE_SUFFIXES: ReadonlyArray<string> = ['+server.ts', 'hooks.server.ts']
const DAST_BASENAMES: ReadonlySet<string> = new Set([
	'_headers',
	'zap-baseline.conf',
	'wrangler.jsonc',
	'svelte.config.js',
])

function is_dast_relevant(file: string): boolean {
	const base = path.basename(file)
	if (DAST_BASENAMES.has(base)) return true
	if (HEADER_ROUTE_SUFFIXES.some((suffix) => base.endsWith(suffix))) return true

	// `+*.server.ts` server-route variants (e.g. +page.server.ts) also emit their own responses.
	return base.startsWith('+') && base.endsWith('.server.ts')
}

// Whether the scan should run for this push. An EMPTY list is fail-safe → scan: the command only
// fires when its glob matched, so no files means the file list could not be resolved, and a
// security check must never be skipped silently. A non-empty list with nothing header/cookie-
// relevant means the scan genuinely cannot find anything new, so it is skipped (preserving #94's
// narrow trigger).
function should_scan(files: ReadonlyArray<string>): boolean {
	if (files.length === 0) return true

	return files.some((file) => is_dast_relevant(file))
}

interface VerifyDependencies {
	preflight_docker: (cwd: string) => void
	build: (cwd: string) => number
	start_preview: (cwd: string, port: number) => Promise<PreviewHandle>
	run_e2e: (cwd: string) => number
	scan: (cwd: string, port: number) => Promise<number>
}

function default_build(cwd: string): number {
	return process_runner.to_exit_status(process_runner.run_pnpm(BUILD_ARGV, cwd))
}

function default_run_e2e(cwd: string): number {
	return process_runner.to_exit_status(
		process_runner.run_pnpm_with_environment(E2E_ARGV, cwd, E2E_ENV),
	)
}

const DEFAULT_DEPENDENCIES: VerifyDependencies = {
	preflight_docker: app_dast.preflight_docker,
	build: default_build,
	start_preview: preview_server.start_preview,
	run_e2e: default_run_e2e,
	scan: app_dast.scan_running_server,
}

// Aggregate the two checks' exit statuses: the command fails if EITHER failed. Neither failure is
// masked — E2E (Playwright) and the scan (ZAP) each write their own output to the terminal, so the
// user sees which failed; this only picks the returned exit code (E2E's when both fail — arbitrary
// but stable, and non-zero either way).
function aggregate_status(e2e_status: number, scan_status: number): number {
	if (e2e_status !== process_runner.SUCCESS_STATUS) return e2e_status

	return scan_status
}

// Run the checks against the one booted server, then tear it down (always). When the scan runs it
// is FANNED OUT with E2E: `deps.scan` spawns the ZAP container asynchronously and returns before it
// finishes, so the container runs at the OS level while the synchronous E2E step executes — the two
// overlap against the single server (both are just HTTP clients; a ZAP baseline scan is passive).
// This hides the scan under a slow E2E suite (#100). E2E no longer short-circuits the scan, so a
// header regression is still reported even if a test also fails.
async function run_against_server(
	cwd: string,
	will_scan: boolean,
	deps: VerifyDependencies,
): Promise<number> {
	const server = await deps.start_preview(cwd, PREVIEW_PORT)

	try {
		if (!will_scan) return deps.run_e2e(cwd)

		// Start the scan first (non-blocking) so its container runs during the synchronous E2E.
		const scan_promise = deps.scan(cwd, PREVIEW_PORT)
		const e2e_status = deps.run_e2e(cwd)

		return aggregate_status(e2e_status, await scan_promise)
	} finally {
		server.stop()
	}
}

async function run_verify(
	cwd: string,
	files: ReadonlyArray<string>,
	deps: VerifyDependencies = DEFAULT_DEPENDENCIES,
): Promise<number> {
	const will_scan = should_scan(files)

	// Fail fast on a missing Docker daemon before the expensive build, but only when the scan will
	// actually run — an E2E-only push must not require Docker.
	if (will_scan) deps.preflight_docker(cwd)

	const build_status = deps.build(cwd)
	if (build_status !== process_runner.SUCCESS_STATUS) return build_status

	return await run_against_server(cwd, will_scan, deps)
}

const app_verify = {
	BUILD_ARGV,
	E2E_ARGV,
	E2E_ENV,
	is_dast_relevant,
	should_scan,
	aggregate_status,
	run_verify,
}

export { app_verify }
export type { VerifyDependencies }
