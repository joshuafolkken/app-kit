import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { cloudflare_init } from '#cloudflare/init.js'

// esbuild bundles this to dist/scripts/josh-app.js, so the package root (with
// templates/) is two levels up from the running file.
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

const SUCCESS_MESSAGE = '✅ josh-app: applied the SvelteKit + Cloudflare layer to this project.'
const USAGE_MESSAGE = 'Usage: josh-app init'

const EXIT_USAGE = 1

// process.argv[0] is node, [1] is this script, [2] is the first user argument.
const COMMAND_ARG_INDEX = 2

// `josh-app init` applies app-kit's SvelteKit + Cloudflare layer (canonical scripts,
// app-shell templates, seeded wrangler.jsonc) to the current project and derives the
// Worker name from its package.json. Run after `josh init`.
function run(command: string | undefined): void {
	if (command !== 'init') {
		console.error(USAGE_MESSAGE)
		process.exit(EXIT_USAGE)
	}

	cloudflare_init.run_init(process.cwd(), PACKAGE_ROOT)
	console.info(SUCCESS_MESSAGE)
}

run(process.argv[COMMAND_ARG_INDEX])
