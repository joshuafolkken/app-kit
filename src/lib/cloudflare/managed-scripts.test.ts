import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { managed_scripts } from './managed-scripts.js'

const ENCODING = 'utf8'
const MANIFEST = 'package.json'
const PREPARE_KEY = 'prepare'
const DEV_KEY = 'dev'

// Both `--port 5173` and `--port=5173` are valid CLI spellings, so a pattern anchored on whitespace
// alone would wave the second one through and the no-literal-port contract would not hold.
const LITERAL_PORT_PATTERN = /--port(?:\s+|=)\d/u

// #183 (kit#825): the port wiring must not run `josh port` through `pnpm`. pnpm writes its own
// text to stdout — `[ELIFECYCLE] Command failed…` on a bad `PORT_SEED`, install/lifecycle logs when
// node_modules is older than package.json — and inside `$(pnpm josh port …)` that text becomes the
// port argument. `pnpm run` puts node_modules/.bin on PATH, so the script calls `josh` directly,
// and the assignment form (`X_PORT=$(josh port x) && server --port $X_PORT`) makes a failed
// resolution stop the server start: an inline substitution's failure would not stop the command
// it is spliced into.
const PNPM_WRAPPED_PORT_PATTERN = /\$\(pnpm\s/u

interface Manifest {
	scripts: Record<string, string>
}

function load_scripts(): Record<string, string> {
	return (JSON.parse(readFileSync(MANIFEST, ENCODING)) as Manifest).scripts
}

function read(path: string): string {
	return readFileSync(path, ENCODING)
}

function line_with(text: string, key: string): string | undefined {
	return text.split('\n').find((line) => line.includes(key))
}

// True only when the key appears as a real (uncommented) JSON field, not a `// "key"` placeholder.
function has_uncommented_key(text: string, key: string): boolean {
	return text.split('\n').some((line) => line.trimStart().startsWith(`"${key}"`))
}

// S2 (#27): app-kit's own package.json is the single source of the Cloudflare
// lifecycle scripts. These guards fail CI if app-kit drifts from the set it
// distributes, or if a managed script is renamed / removed.
describe('Cloudflare managed-scripts single source', () => {
	it('app-kit package.json defines every managed script key', () => {
		const scripts = load_scripts()

		for (const key of managed_scripts.MANAGED_SCRIPT_KEYS) {
			expect(scripts[key], `scripts.${key}`).toBeTypeOf('string')
		}
	})

	it('CANONICAL_PREPARE matches app-kit package.json (npm strips this key on publish)', () => {
		expect(load_scripts()[PREPARE_KEY]).toBe(managed_scripts.CANONICAL_PREPARE)
	})

	it('read_canonical_scripts returns a non-empty value for every managed key', () => {
		const canonical = managed_scripts.read_canonical_scripts(MANIFEST)

		for (const key of managed_scripts.MANAGED_SCRIPT_KEYS) {
			expect(canonical[key]).toBeTruthy()
		}
	})

	// #88: the distributed `preview` script must run `wrangler dev` in local mode.
	// Without `--local`, a consumer with a remote-only binding (AI Search / `remote: true`)
	// makes wrangler open a remote proxy session that needs credentials, so `pnpm preview`
	// — and therefore Playwright's webServer — fails to start in non-interactive CI.
	it('preview runs wrangler dev in local mode — never a credential-requiring remote proxy', () => {
		const { preview } = managed_scripts.read_canonical_scripts(MANIFEST)

		expect(preview).toContain('wrangler dev')
		expect(preview).toContain('--local')
		expect(preview).not.toContain('--remote')
	})

	// #177: the port wrangler binds must come from kit's single definition, the same source
	// playwright.config.ts and `josh-app dast` read. A literal here would agree with them only while
	// `PORT_SEED` is 0: with a seed set, Playwright's webServer and the ZAP scan would both wait on
	// the seeded port while this script started wrangler on 4173.
	it('preview binds the port kit resolves — never a literal, never through pnpm', () => {
		const { preview } = managed_scripts.read_canonical_scripts(MANIFEST)

		expect(preview.startsWith('PREVIEW_PORT=$(josh port preview) && ')).toBe(true)
		expect(preview).toContain('--port $PREVIEW_PORT')
		expect(preview).not.toMatch(LITERAL_PORT_PATTERN)
		expect(preview).not.toMatch(PNPM_WRAPPED_PORT_PATTERN)
	})

	// #56: prepare:gen is the only automatic `wrangler types` invocation and
	// worker-configuration.d.ts is gitignored, so a swallowed gen failure ships a
	// misleading `Cannot find name 'Env'` from svelte-check instead of the real cause.
	// Guard the fail-loud form so a `|| true` is never re-introduced (here or in a consumer).
	it('prepare:gen is fail-loud — it never swallows wrangler-types failures with `|| true`', () => {
		const prepare_gen = managed_scripts.read_canonical_scripts(MANIFEST)['prepare:gen']

		expect(prepare_gen).toBe('[ ! -f wrangler.jsonc ] || pnpm gen')
		expect(prepare_gen).not.toContain('|| true')
	})
})

// `dev` is the other half of the same contract as `preview` above: playwright.config.ts runs
// `pnpm run dev` on its local branch and `pnpm run preview` on its CI branch, waiting on the dev
// and preview port it resolves from kit. Both scripts have to derive their port from that same
// definition or the suite waits on a port nothing opened (#181).
//
// #188: app-kit's own manifest already had the wiring while every consumer kept a bare `vite dev`
// on 5173, because only `preview` was a managed key — so a seeded project's Playwright waited on
// 5173 + seed and lost the suite to a webServer timeout no `sync` could repair. The membership
// assertion below is what covers consumers; the two shape assertions read through
// read_canonical_scripts to go the same way `sync` does, which additionally makes a renamed or
// removed key throw rather than assert against `undefined`.
describe('dev server script derives its port from kit', () => {
	it('is a managed key, so `josh-app sync` repairs it in an existing consumer', () => {
		expect(managed_scripts.MANAGED_SCRIPT_KEYS).toContain(DEV_KEY)
	})

	it('binds the port kit resolves — never a literal, never through pnpm', () => {
		const { dev } = managed_scripts.read_canonical_scripts(MANIFEST)

		expect(dev.startsWith('DEV_PORT=$(josh port dev) && ')).toBe(true)
		expect(dev).toContain('--port $DEV_PORT')
		expect(dev).not.toMatch(LITERAL_PORT_PATTERN)
		expect(dev).not.toMatch(PNPM_WRAPPED_PORT_PATTERN)
	})

	// Why the flag has to be there: vite does not fail on a busy port — it prints `Port N is in use,
	// trying another one...` and binds the next free one (observed on vite 8.2.2). Left to drift, a
	// seeded dev port silently lands somewhere Playwright is not waiting, so the seed fixes nothing
	// and the timeout just gets a new cause. `--strictPort` is what makes the collision loud,
	// matching the guarantee the PORT_SEED docs state and the fail-loud precedent app-kit#136 set
	// for the preview port. This asserts the flag is declared, not vite's reaction to a taken port —
	// exercising that needs a real listener and a real boot, which belongs nowhere near a unit suite.
	it('declares --strictPort, the flag that stops vite drifting off a busy port', () => {
		const { dev } = managed_scripts.read_canonical_scripts(MANIFEST)

		expect(dev).toContain('--strictPort')
	})
})

// The published app-shell templates must stay byte-identical to the files app-kit
// itself ships, so the seed a consumer scaffolds from is always what app-kit runs.
describe('app-shell templates mirror app-kit own files', () => {
	it('templates/app.html equals src/app.html', () => {
		expect(read('templates/app.html')).toBe(read('src/app.html'))
	})

	it('templates/app.d.ts equals src/app.d.ts', () => {
		expect(read('templates/app.d.ts')).toBe(read('src/app.d.ts'))
	})

	// The wrangler template is NOT byte-equal to app-kit's own: it shares the canonical
	// framework fields but replaces the per-project ones (name, routes) with commented
	// placeholders so a consumer never inherits app-kit's worker name or domain.
	it('templates/wrangler.jsonc shares app-kit canonical fields, placeholders per-project ones', () => {
		const template = read('templates/wrangler.jsonc')
		const own = read('wrangler.jsonc')
		const date = 'compatibility_date'
		const flags = 'compatibility_flags'

		expect(line_with(template, date)).toBe(line_with(own, date))
		expect(line_with(template, flags)).toBe(line_with(own, flags))
		expect(has_uncommented_key(template, 'name')).toBe(false)
		expect(has_uncommented_key(template, 'routes')).toBe(false)
	})
})
