import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { cloudflare_init } from '#cloudflare/init.js'
import { cloudflare_orchestrate } from '#cloudflare/orchestrate.js'
import { cloudflare_sync } from '#cloudflare/sync.js'
import { app_version } from '#version/version.js'

// esbuild bundles this to dist/scripts/josh-app.js; SELF_DIR is the running bin's own directory
// (version uses it for running-binary detection) and the package root (with templates/) is two
// levels up.
const SELF_DIR = path.dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = path.resolve(SELF_DIR, '../..')

const INIT_MESSAGE = '✅ josh-app: applied the SvelteKit + Cloudflare layer to this project.'
const SYNC_MESSAGE = '✅ josh-app: re-synced the SvelteKit + Cloudflare overlay.'
const USAGE_MESSAGE = 'Usage: josh-app <init|sync|version|v|version:upgrade|vu>'

const EXIT_USAGE = 1

// process.argv[0] is node, [1] is this script, [2] is the first user argument.
const COMMAND_ARG_INDEX = 2

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

// `version` shows the installed-vs-latest report; `version:upgrade` upgrades and exits non-zero
// only when a pnpm upgrade fails. Both delegate to kit's shared version library.
function run_version(): void {
	app_version.run_check(SELF_DIR)
}

function run_version_upgrade(): void {
	const code = app_version.run_upgrade(SELF_DIR)

	if (code !== 0) process.exit(code)
}

const VERSION = 'version'
const VERSION_UPGRADE = 'version:upgrade'

// A Map (not an object literal) so a command name carrying a colon (`version:upgrade`) stays a
// plain string key rather than an object property that the naming-convention rule would reject.
const COMMAND_HANDLERS = new Map<string, () => void>([
	['init', run_init],
	['sync', run_sync],
	[VERSION, run_version],
	[VERSION_UPGRADE, run_version_upgrade],
])

const COMMAND_ALIASES: Record<string, string> = { v: VERSION, vu: VERSION_UPGRADE }

function run(command: string | undefined): void {
	const resolved = command === undefined ? '' : (COMMAND_ALIASES[command] ?? command)
	const handler = COMMAND_HANDLERS.get(resolved)

	if (handler === undefined) {
		console.error(USAGE_MESSAGE)
		process.exit(EXIT_USAGE)
	}

	handler()
}

run(process.argv[COMMAND_ARG_INDEX])
