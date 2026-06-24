import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { cloudflare_init } from '#cloudflare/init.js'
import { cloudflare_sync } from '#cloudflare/sync.js'

// esbuild bundles this to dist/scripts/josh-app.js, so the package root (with
// templates/) is two levels up from the running file.
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

const INIT_MESSAGE = '✅ josh-app: applied the SvelteKit + Cloudflare layer to this project.'
const SYNC_MESSAGE = '✅ josh-app: re-synced the SvelteKit + Cloudflare overlay.'
const USAGE_MESSAGE = 'Usage: josh-app <init|sync>'

const EXIT_USAGE = 1

// process.argv[0] is node, [1] is this script, [2] is the first user argument.
const COMMAND_ARG_INDEX = 2

// `init` is the one-time setup — apply the overlay and derive the Worker name from the
// project package.json. `sync` re-applies the overlay only (canonical scripts, app-shell
// templates, seeded wrangler.jsonc), leaving the Worker name for the consumer to own.
function run(command: string | undefined): void {
	if (command === 'init') {
		cloudflare_init.run_init(process.cwd(), PACKAGE_ROOT)
		console.info(INIT_MESSAGE)

		return
	}

	if (command === 'sync') {
		cloudflare_sync.apply_overlay(process.cwd(), PACKAGE_ROOT)
		console.info(SYNC_MESSAGE)

		return
	}

	console.error(USAGE_MESSAGE)
	process.exit(EXIT_USAGE)
}

run(process.argv[COMMAND_ARG_INDEX])
