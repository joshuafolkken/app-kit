import { ports } from '@joshuafolkken/kit/ports'

// Where the preview server's port number comes from, for every app-kit command that talks to that
// server (`dast`, `load`, `verify`). kit owns the number — `@joshuafolkken/kit/ports` offsets the
// 4173 base by the personal `PORT_SEED` so several kit projects can run their previews at once —
// and this module is the one place app-kit asks for it. Before app-kit#177 each command carried its
// own `const PREVIEW_PORT = 4173`, which agreed with kit only while the seed was 0.
//
// `.env` is loaded first because `josh-app` is an esbuild-bundled node binary: nothing on its path
// supplies tsx's `--env-file-if-exists=.env`, so `PORT_SEED` never reaches `process.env` and the
// resolver would hand back the unseeded 4173 while `josh port preview` — which DOES get the
// file, and is what the distributed `preview` script asks — starts wrangler on the seeded one. That
// is the same disagreement kit#820 fixed on the Playwright side, and playwright.config.ts opens
// with this identical call for the identical reason.
//
// Resolution is per-call rather than a module constant so an invalid seed throws only for the
// commands that need a port: as a constant it would throw at import time and take down every
// `josh-app` subcommand, `version` included.
function resolve(cwd: string = process.cwd()): number {
	ports.load_environment_file(cwd)

	return ports.resolve_preview_port()
}

const preview_port = { resolve }

export { preview_port }
