import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { process_runner, type CommandRunner } from '#process/runner.js'
import { preview_server, type PreviewHandle } from './preview.js'
import { zap } from './zap.js'

// `josh-app dast`: build the app, boot the preview server, run the OWASP ZAP baseline scan
// against it, and tear the server down — including on failure. The scan is passive (no attack
// traffic), so it is safe to point at a local preview.
//
// Port 4173 is the preview server's own port, shared with playwright.config.ts.
const PREVIEW_PORT = 4173

const BUILD_ARGV: ReadonlyArray<string> = ['run', 'build']

// A missing Docker daemon fails loudly instead of skipping: a security check that silently
// no-ops is worse than one that is absent, because the green result is misread as coverage
// (the precedent set in joshuafolkken/kit#670).
const DOCKER_UNAVAILABLE_MESSAGE = [
	'josh-app dast requires a running Docker daemon (the ZAP baseline scan runs in a container).',
	'Start Docker and re-run — the scan is never skipped silently.',
].join('\n')

// A missing daemon is an environment condition the user can fix, not a defect in app-kit, so the
// CLI reports it as a plain actionable message. Its own type keeps that presentation from also
// swallowing the stack trace of a genuine bug.
class DastEnvironmentError extends Error {
	public constructor(message: string, options?: ErrorOptions) {
		super(message, options)
		this.name = 'DastEnvironmentError'
	}
}

// The directory bind-mounted at /zap/wrk, plus the config basename to pass to `-c` (undefined
// when the project has no baseline config yet).
interface ZapWorkspace {
	directory: string
	config_file: string | undefined
}

interface DastDependencies {
	docker: CommandRunner
	pnpm: CommandRunner
	start_preview: (cwd: string, port: number) => Promise<PreviewHandle>
	open_workspace: (cwd: string) => ZapWorkspace
	close_workspace: (workspace: ZapWorkspace) => void
}

function default_docker(argv: ReadonlyArray<string>, cwd: string): ReturnType<CommandRunner> {
	return process_runner.run_command(zap.DOCKER_BIN, argv, cwd)
}

// zap-baseline.py writes its generated automation plan (zap.yaml) into /zap/wrk, so mounting the
// project there would drop an untracked artifact into the repo after every scan — in app-kit's
// tree and in every consumer's. A throwaway directory holding nothing but a copy of the baseline
// config fixes that, and as a bonus stops handing the scanner container write access to the whole
// source tree.
function open_workspace(cwd: string): ZapWorkspace {
	const directory = mkdtempSync(path.join(tmpdir(), 'app-kit-zap-'))
	const source = path.join(cwd, zap.ZAP_CONFIG_FILE)

	if (!existsSync(source)) return { directory, config_file: undefined }

	copyFileSync(source, path.join(directory, zap.ZAP_CONFIG_FILE))

	return { directory, config_file: zap.ZAP_CONFIG_FILE }
}

function close_workspace(workspace: ZapWorkspace): void {
	rmSync(workspace.directory, { recursive: true, force: true })
}

const DEFAULT_DEPENDENCIES: DastDependencies = {
	docker: default_docker,
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
		throw new DastEnvironmentError(DOCKER_UNAVAILABLE_MESSAGE)
	}
}

// The scan's exit status is passed through untouched: zap-baseline.py exits 0 only when nothing
// was reported, so any finding — FAIL or WARN — fails the command.
async function run_scan(
	cwd: string,
	workspace: ZapWorkspace,
	deps: DastDependencies,
): Promise<number> {
	const server = await deps.start_preview(cwd, PREVIEW_PORT)

	try {
		const argv = zap.build_scan_argv(workspace.directory, PREVIEW_PORT, workspace.config_file)

		return process_runner.to_exit_status(deps.docker(argv, cwd))
	} finally {
		server.stop()
	}
}

// The workspace is opened outside run_scan's try so that a preview server which never boots still
// gets its temp directory cleaned up.
async function scan_against_preview(cwd: string, deps: DastDependencies): Promise<number> {
	const workspace = deps.open_workspace(cwd)

	try {
		return await run_scan(cwd, workspace, deps)
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

async function run_dast(
	cwd: string,
	deps: DastDependencies = DEFAULT_DEPENDENCIES,
): Promise<number> {
	assert_docker_available(deps, cwd)

	const build_status = process_runner.to_exit_status(deps.pnpm(BUILD_ARGV, cwd))
	if (build_status !== process_runner.SUCCESS_STATUS) return build_status

	return await scan_against_preview(cwd, deps)
}

const app_dast = {
	PREVIEW_PORT,
	BUILD_ARGV,
	DOCKER_UNAVAILABLE_MESSAGE,
	DastEnvironmentError,
	describe_result,
	open_workspace,
	close_workspace,
	run_dast,
}

export { app_dast }
export type { DastDependencies, ZapWorkspace }
