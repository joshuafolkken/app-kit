import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { app_check } from '#check/check.js'
import { cloudflare_init } from '#cloudflare/init.js'
import { cloudflare_orchestrate } from '#cloudflare/orchestrate.js'
import { cloudflare_sync } from '#cloudflare/sync.js'
import { app_dast } from '#dast/dast.js'
import { app_verify } from '#verify/verify.js'
import { app_version } from '#version/version.js'

// esbuild bundles this to dist/scripts/josh-app.js; SELF_DIR is the running bin's own directory
// (version uses it for running-binary detection). The package root (with templates/) is found by
// walking up to app-kit's own package.json — a fixed `../..` would be wrong when this entry runs
// from source via the repo's `josh-app` script (scripts/ is one level deep, dist/scripts/ two).
const SELF_DIR = path.dirname(fileURLToPath(import.meta.url))
const PACKAGE_NAME = '@joshuafolkken/app-kit'

function resolve_package_root(start: string): string {
	const root = cloudflare_orchestrate.find_package_root(start, PACKAGE_NAME)
	if (root !== undefined) return root

	throw new Error(`Cannot locate ${PACKAGE_NAME} from ${start}`)
}

const PACKAGE_ROOT = resolve_package_root(SELF_DIR)

const INIT_MESSAGE = '✅ josh-app: applied the SvelteKit + Cloudflare layer to this project.'
const SYNC_MESSAGE = '✅ josh-app: re-synced the SvelteKit + Cloudflare overlay.'
const USAGE_MESSAGE =
	'Usage: josh-app <init|sync|check|check:ci|dast|verify|version|v|version:upgrade|vu>'

const EXIT_USAGE = 1
// A prerequisite the user can fix (e.g. Docker not running) — distinct in intent from a usage
// error, though both are non-zero so CI and the pre-push hook block either way.
const EXIT_ENVIRONMENT = 1

// process.argv[0] is node, [1] is this script, [2] is the first user argument.
const COMMAND_ARG_INDEX = 2
// verify receives the pushed file list (lefthook `{push_files}`) as its remaining arguments.
const FILE_ARGS_START_INDEX = 3

// Orchestrate kit's framework-agnostic base (`josh init`) first, then apply the app-kit overlay —
// one command delivers base + overlay without app-kit duplicating kit's managed file list.
function run_init(): void {
	cloudflare_orchestrate.run_base_init(process.cwd())
	const changes = cloudflare_init.run_init(process.cwd(), PACKAGE_ROOT)

	console.info(`${cloudflare_sync.summarize(changes)}\n${INIT_MESSAGE}`)
}

// Orchestrate kit's base (`josh sync`) first, then apply the app-kit overlay (scripts, seeds, and
// the SvelteKit-line reconciliation in cspell / tsconfig) — base + overlay in one command.
function run_sync(): void {
	cloudflare_orchestrate.run_base_sync(process.cwd())
	const changes = cloudflare_sync.apply_overlay(process.cwd(), PACKAGE_ROOT)

	console.info(`${cloudflare_sync.summarize(changes)}\n${SYNC_MESSAGE}`)
}

function exit_on_failure(code: number): void {
	if (code !== 0) process.exit(code)
}

// `version` shows the installed-vs-latest report; `version:upgrade` upgrades and exits non-zero
// only when a pnpm upgrade fails. Both delegate to kit's shared version library.
function run_version(): void {
	app_version.run_check(SELF_DIR)
}

function run_version_upgrade(): void {
	exit_on_failure(app_version.run_upgrade(SELF_DIR))
}

// SvelteKit type-check commands hosted by app-kit (the receiver for kit#628's removal of kit's
// `check:svelte*`): `check` is the fast incremental dev loop, `check:ci` the strict CI variant.
function run_check(): void {
	exit_on_failure(app_check.run_check(process.cwd()))
}

function run_check_ci(): void {
	exit_on_failure(app_check.run_check_ci(process.cwd()))
}

// A missing Docker daemon is reported as a plain actionable line; anything else keeps its stack
// trace, so a real defect is never disguised as an environment problem. Shared by `dast` and
// `verify`, both of which preflight Docker.
function report_environment_error(error: unknown): never {
	if (!(error instanceof app_dast.DastEnvironmentError)) throw error

	console.error(error.message)
	process.exit(EXIT_ENVIRONMENT)
}

// Dynamic baseline security scan against the running preview server — the one layer that probes
// the real HTTP surface, which the static analyzers (CodeQL, Sonar, OSV) structurally cannot see.
async function run_dast(): Promise<void> {
	try {
		const status = await app_dast.run_dast(process.cwd())

		console.info(app_dast.describe_result(status))
		exit_on_failure(status)
	} catch (error) {
		report_environment_error(error)
	}
}

// Unified pre-push runtime gate: build once, boot the preview once, run E2E and (only when a
// header/cookie-affecting file changed) the ZAP scan against that single server, tear it down.
// The pushed file list arrives as the trailing arguments (lefthook `{push_files}`).
async function run_verify(): Promise<void> {
	const files = process.argv.slice(FILE_ARGS_START_INDEX)

	try {
		exit_on_failure(await app_verify.run_verify(process.cwd(), files))
	} catch (error) {
		report_environment_error(error)
	}
}

const VERSION = 'version'
const VERSION_UPGRADE = 'version:upgrade'

// A Map (not an object literal) so a command name carrying a colon (`version:upgrade`) stays a
// plain string key rather than an object property that the naming-convention rule would reject.
// `dast` is async (it awaits the preview server's readiness), so the handler type admits both.
const COMMAND_HANDLERS = new Map<string, () => void | Promise<void>>([
	['init', run_init],
	['sync', run_sync],
	['check', run_check],
	['check:ci', run_check_ci],
	['dast', run_dast],
	['verify', run_verify],
	[VERSION, run_version],
	[VERSION_UPGRADE, run_version_upgrade],
])

const COMMAND_ALIASES: Record<string, string> = { v: VERSION, vu: VERSION_UPGRADE }

async function run(command: string | undefined): Promise<void> {
	const resolved = command === undefined ? '' : (COMMAND_ALIASES[command] ?? command)
	const handler = COMMAND_HANDLERS.get(resolved)

	if (handler === undefined) {
		console.error(USAGE_MESSAGE)
		process.exit(EXIT_USAGE)
	}

	await handler()
}

await run(process.argv[COMMAND_ARG_INDEX])
