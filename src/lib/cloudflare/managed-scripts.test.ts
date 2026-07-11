import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { managed_scripts } from './managed-scripts.js'

const ENCODING = 'utf8'
const MANIFEST = 'package.json'
const PREPARE_KEY = 'prepare'

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
