import { chmodSync, copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { SpawnOutcome } from '#cloudflare/orchestrate.js'
import { EnvironmentError } from '#process/environment-error.js'
import { process_runner, type CommandRunner } from '#process/runner.js'
import { preview_port } from './preview-port.js'
import { preview_server, type PreviewHandle } from './preview.js'
import { zap } from './zap.js'

// `josh-app dast`: build the app, boot the preview server, run the OWASP ZAP baseline scan
// against it, and tear the server down — including on failure. The scan is passive (no attack
// traffic), so it is safe to point at a local preview.
//
// The preview port is resolved through preview_port, kit's single definition — the same number
// playwright.config.ts and the distributed `preview` script derive (app-kit#177).

// A missing Docker daemon fails loudly instead of skipping: a security check that silently
// no-ops is worse than one that is absent, because the green result is misread as coverage
// (the precedent set in joshuafolkken/kit#670).
const DOCKER_UNAVAILABLE_MESSAGE = [
	'josh-app dast requires a running Docker daemon (the ZAP baseline scan runs in a container).',
	'Start Docker and re-run — the scan is never skipped silently.',
].join('\n')

// The directory bind-mounted at /zap/wrk, plus the config basename to pass to `-c` (undefined
// when the project has no baseline config yet).
interface ZapWorkspace {
	directory: string
	config_file: string | undefined
}

// The scan container run is async so the `verify` fan-out can run it concurrently with E2E; the
// preflight (`docker info`) stays synchronous — it is quick and its result gates whether the
// expensive work starts at all.
type AsyncCommandRunner = (argv: ReadonlyArray<string>, cwd: string) => Promise<SpawnOutcome>

interface DastDependencies {
	docker: CommandRunner
	docker_scan: AsyncCommandRunner
	pnpm: CommandRunner
	start_preview: (cwd: string, port: number) => Promise<PreviewHandle>
	open_workspace: (cwd: string) => ZapWorkspace
	close_workspace: (workspace: ZapWorkspace) => void
}

function default_docker(argv: ReadonlyArray<string>, cwd: string): ReturnType<CommandRunner> {
	return process_runner.run_command(zap.DOCKER_BIN, argv, cwd)
}

async function default_docker_scan(
	argv: ReadonlyArray<string>,
	cwd: string,
): Promise<SpawnOutcome> {
	return await process_runner.run_command_async(zap.DOCKER_BIN, argv, cwd)
}

// zap-baseline.py writes its generated automation plan (zap.yaml) into /zap/wrk, so mounting the
// project there would drop an untracked artifact into the repo after every scan — in app-kit's
// tree and in every consumer's. A throwaway directory holding nothing but a copy of the baseline
// config fixes that, and as a bonus stops handing the scanner container write access to the whole
// source tree.
//
// `mkdtemp` creates the directory 0700 (owner-only). The ZAP container runs as its own `zap` user
// — a DIFFERENT uid on Linux CI — and must traverse /zap/wrk, read the config, and write its
// generated plan there. So the mount is widened to be accessible cross-uid: without this the scan
// dies with `PermissionError: /zap/wrk/zap-baseline.conf`. macOS Docker Desktop ignores unix
// perms, which is why 0700 only fails on Linux (green local scan, red CI).
const WORKSPACE_DIR_MODE = 0o777
const WORKSPACE_FILE_MODE = 0o644

function open_workspace(cwd: string): ZapWorkspace {
	const directory = mkdtempSync(path.join(tmpdir(), 'app-kit-zap-'))

	chmodSync(directory, WORKSPACE_DIR_MODE)

	const source = path.join(cwd, zap.ZAP_CONFIG_FILE)
	if (!existsSync(source)) return { directory, config_file: undefined }

	const destination = path.join(directory, zap.ZAP_CONFIG_FILE)

	copyFileSync(source, destination)
	chmodSync(destination, WORKSPACE_FILE_MODE)

	return { directory, config_file: zap.ZAP_CONFIG_FILE }
}

function close_workspace(workspace: ZapWorkspace): void {
	rmSync(workspace.directory, { recursive: true, force: true })
}

const DEFAULT_DEPENDENCIES: DastDependencies = {
	docker: default_docker,
	docker_scan: default_docker_scan,
	pnpm: process_runner.run_pnpm,
	start_preview: preview_server.start_preview,
	open_workspace,
	close_workspace,
}

// `docker info` fails both when the CLI is absent (spawn error) and when the daemon is down
// (non-zero status); both are the same actionable condition, so both raise the same message.
function assert_docker_available(deps: DastDependencies, cwd: string): void {
	const outcome = deps.docker(zap.PREFLIGHT_ARGV, cwd)

	if (outcome.error !== undefined || outcome.status !== process_runner.SUCCESS_STATUS) {
		throw new EnvironmentError(DOCKER_UNAVAILABLE_MESSAGE)
	}
}

// Public preflight for callers (the `verify` orchestrator) that need to fail fast on a missing
// Docker daemon before doing expensive work, using the default runner.
function preflight_docker(cwd: string, deps: DastDependencies = DEFAULT_DEPENDENCIES): void {
	assert_docker_available(deps, cwd)
}

// Run the ZAP baseline scan against a server ALREADY LISTENING on `port` — no build, no preview
// lifecycle here. The disposable workspace (mounted at /zap/wrk) is opened and torn down in this
// function, so the caller only has to guarantee the server is up and reachable. Shared by the
// standalone `josh-app dast` (which boots its own preview first) and the `verify` orchestrator
// (which shares one preview server with the E2E run). The scan's exit status is passed through
// untouched: zap-baseline.py exits 0 only when nothing was reported, so any finding — FAIL or
// WARN — fails the caller.
async function scan_running_server(
	cwd: string,
	port: number,
	deps: DastDependencies = DEFAULT_DEPENDENCIES,
): Promise<number> {
	const workspace = deps.open_workspace(cwd)

	try {
		const argv = zap.build_scan_argv(workspace.directory, port, workspace.config_file)

		return process_runner.to_exit_status(await deps.docker_scan(argv, cwd))
	} finally {
		deps.close_workspace(workspace)
	}
}

// The scan's own output ends with ZAP's counts, and the torn-down preview server may still emit
// shutdown noise after it. An explicit closing line makes the outcome unambiguous rather than
// leaving the reader to interpret whatever happened to print last.
function describe_result(status: number): string {
	if (status === process_runner.SUCCESS_STATUS) {
		return '✅ josh-app dast: scan passed — no new findings (baselined rules are listed in zap-baseline.conf).'
	}

	return `❌ josh-app dast: scan failed with status ${String(status)} — see the ZAP summary above.`
}

// Standalone `josh-app dast`: preflight Docker, build, boot the preview it owns, scan it, tear it
// down. The preview lifecycle lives here (not in scan_running_server) so the scan step stays a
// pure "scan a running server" primitive the orchestrator can reuse.
async function run_dast(
	cwd: string,
	deps: DastDependencies = DEFAULT_DEPENDENCIES,
): Promise<number> {
	assert_docker_available(deps, cwd)

	// Resolved before the build for the same reason the Docker preflight runs there: a malformed
	// PORT_SEED throws, and discovering that after a full build wastes the whole build.
	const port = preview_port.resolve(cwd)

	const build_status = process_runner.to_exit_status(deps.pnpm(process_runner.BUILD_ARGV, cwd))
	if (build_status !== process_runner.SUCCESS_STATUS) return build_status

	const server = await deps.start_preview(cwd, port)

	try {
		return await scan_running_server(cwd, port, deps)
	} finally {
		server.stop()
	}
}

const app_dast = {
	DOCKER_UNAVAILABLE_MESSAGE,
	describe_result,
	preflight_docker,
	scan_running_server,
	open_workspace,
	close_workspace,
	run_dast,
}

export { app_dast }
export type { DastDependencies, ZapWorkspace }
