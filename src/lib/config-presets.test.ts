import { existsSync, readFileSync } from 'node:fs'
import { config_merge } from '@joshuafolkken/kit/config-merge'
import { app_verify } from '#verify/verify.js'
import { describe, expect, it } from 'vitest'

const SVELTE_CONFIG = 'svelte.config.js'

// Each DAST-relevant lefthook glob entry paired with a file that should match it — used to guard
// that the lefthook glob and verify.ts's is_dast_relevant predicate stay in lockstep.
const DAST_GLOB_SAMPLES: ReadonlyArray<readonly [string, string]> = [
	["- '_headers'", '_headers'],
	["- 'zap-baseline.conf'", 'zap-baseline.conf'],
	["- 'wrangler.jsonc'", 'wrangler.jsonc'],
	["- 'svelte.config.js'", SVELTE_CONFIG],
	["- 'src/hooks.server.ts'", 'src/hooks.server.ts'],
	["- '**/+server.ts'", 'src/routes/api/+server.ts'],
	["- '**/+*.server.ts'", 'src/routes/dashboard/+page.server.ts'],
]

const ENCODING = 'utf8'
const MANIFEST = 'package.json'
const KIT = '@joshuafolkken/kit'
const ESLINT_PRESET = 'eslint/sveltekit.js'
const LEFTHOOK_PRESET = 'lefthook/sveltekit.yml'
const KIT_LEFTHOOK_BASE = 'node_modules/@joshuafolkken/kit/lefthook/base.yml'
// The preset MUST keep a `.json` extension (#113): Playwright (>= 1.62) appends `.json` to any
// tsconfig `extends` entry not already ending in it and hard-throws when the result is missing, so
// a `.jsonc` preset resolves to `*.jsonc.json` and takes the E2E suite down before the first test.
const TSCONFIG_PRESET = './tsconfig/sveltekit.json'
const ROOT_TSCONFIG = 'tsconfig.json'
const SECURITY_E2E_SUBPATH = './security/e2e'
// One built file behind two conditions — see the #132 note on the test below.
const SECURITY_E2E_MODULE = './dist/security/e2e.js'
const VSCODE_SETTINGS = '.vscode/settings.json'
// VSCode setting keys are dotted, so they are read through an index rather than a declared
// interface — a `files.associations` property would trip the snake_case/camelCase naming rule.
const ASSOCIATIONS_KEY = 'files.associations'
const TSCONFIG_ASSOCIATION_GLOB = '**/tsconfig/*.json'

interface RootTsconfig {
	extends: Array<string>
}

interface Manifest {
	files: Array<string>
	exports: Record<string, unknown>
	peerDependencies: Record<string, string>
}

function load_manifest(): Manifest {
	return JSON.parse(readFileSync(MANIFEST, ENCODING)) as Manifest
}

function read_file(path: string): string {
	return readFileSync(path, ENCODING)
}

// S1 (#26): app-kit owns the SvelteKit config presets, built ON kit's generic
// base (kit base + delta, no fork). These lock the export surface and the
// "extends/import/re-export kit, never copy" contract.
describe('SvelteKit config preset exports', () => {
	it('exposes the three /sveltekit preset subpaths', () => {
		const { exports } = load_manifest()

		expect(exports['./eslint/sveltekit']).toBe('./eslint/sveltekit.js')
		expect(exports['./tsconfig/sveltekit']).toMatchObject({ default: TSCONFIG_PRESET })
		expect(exports['./cspell/sveltekit']).toBe('./cspell/sveltekit.yaml')
	})

	// #120: the seeded security-headers spec imports this subpath by name. Dropping or renaming the
	// export breaks the E2E of every consumer that has already synced, not just new ones — and it
	// breaks at their `pnpm update`, far from the change that caused it.
	//
	// #132: `default` is load-bearing, not decoration. Playwright runs the seeded spec in Node, which
	// resolves with ["node", "import"] and matches neither `types` nor `svelte` — without a catch-all
	// the subpath is "not exported" and the whole suite fails to collect. The real guard lives in
	// package-manifest.test.ts (it resolves the specifier through Node); this pins the map shape.
	it('exposes the security-headers E2E assertions the seeded spec imports', () => {
		expect(load_manifest().exports[SECURITY_E2E_SUBPATH]).toMatchObject({
			types: './dist/security/e2e.d.ts',
			svelte: SECURITY_E2E_MODULE,
			default: SECURITY_E2E_MODULE,
		})
	})

	it('publishes the preset directories and declares kit as a peer', () => {
		const { files, peerDependencies: peer_dependencies } = load_manifest()

		expect(files).toEqual(expect.arrayContaining(['eslint', 'tsconfig', 'cspell', 'lefthook']))
		expect(peer_dependencies[KIT]).toBeDefined()
	})
})

// #66: app-kit owns the SvelteKit lefthook preset (kit#601 removes kit's). These lock in the two
// non-obvious lefthook merge facts the preset depends on (see kit#629), so a future edit cannot
// silently regress them:
//   1. nested `extends` resolves from the consumer git root — base MUST be a root-relative
//      node_modules path, never `./base.yml` (which never merges → base hooks vanish).
//   2. the extended file wins on a name collision — the SvelteKit commands MUST use distinct
//      `*-svelte` names so they add coverage instead of being clobbered by base.
function read_lefthook_preset(): string {
	return read_file(LEFTHOOK_PRESET)
}

describe('SvelteKit lefthook preset — base composition (#66)', () => {
	it('extends kit base via a root-relative node_modules path, never ./base.yml', () => {
		const extends_list = config_merge.read_yaml_list_field(read_lefthook_preset(), 'extends')

		expect(extends_list).toEqual([KIT_LEFTHOOK_BASE])
		expect(extends_list).not.toContain('./base.yml')
	})

	it('adds the svelte delta under distinct *-svelte command names scoped to *.svelte', () => {
		const source = read_lefthook_preset()

		for (const tool of ['cspell', 'prettier', 'eslint']) {
			expect(source).toMatch(
				new RegExp(String.raw`\n\s+${tool}-svelte:\n\s+glob:\s*'\*\.svelte'`, 'u'),
			)
		}
	})

	it('never redefines a base command name, so base survives the merge intact', () => {
		const source = read_lefthook_preset()

		// a key like `cspell:` (vs `cspell-svelte:`) would collide and let base override the delta
		for (const name of ['cspell', 'prettier', 'eslint', 'type-check']) {
			expect(source).not.toMatch(new RegExp(String.raw`\n\s+${name}:`, 'u'))
		}
	})
})

describe('SvelteKit lefthook preset — command coverage (#66)', () => {
	it('triggers type-check svelte-check on any code change, not just .svelte', () => {
		const source = read_lefthook_preset()

		// wide trigger: base's `tsc` cannot see `.svelte`, so svelte-check must still run when a
		// `.ts`/`.js` change breaks a `.svelte` consumer — narrowing this to `*.svelte` regresses
		// coverage versus the original kit preset
		expect(source).toMatch(/type-check-svelte:\n\s+glob:\s*'\*\.\{svelte,ts,js,mjs,cjs\}'/u)
	})

	it('delegates type-check to josh-app check:ci — the single source of sync+svelte-check (#78)', () => {
		const source = read_lefthook_preset()

		// anchored to type-check-svelte's OWN run line (no cross-command [\s\S]*), so gutting this
		// command's run can't pass by the string surviving under a different command
		expect(source).toMatch(/type-check-svelte:\n\s+glob:[^\n]*\n\s+run: pnpm josh-app check:ci/u)
	})

	it('gates pre-push on the unified verify command (#97)', () => {
		// E2E moved from a standalone `test-e2e` command into the merged `verify` orchestrator; the
		// CI env for Playwright now lives in verify.ts (E2E_ENV), not the lefthook.
		const source = read_lefthook_preset()
		const commands_index = source.indexOf('pre-push:\n  commands:')
		const verify_index = source.indexOf('\n    verify:\n')

		expect(commands_index).toBeGreaterThanOrEqual(0)
		expect(verify_index).toBeGreaterThan(commands_index)
		expect(source).toContain('run: pnpm josh-app verify {push_files}')
	})
})

// eslint is now INTERNALIZED (#52, epic #9 Phase C): it composes kit's generic base +
// eslint-plugin-svelte + app-kit's own SvelteKit delta in-house, instead of re-exporting
// kit's `create_sveltekit_config`. cspell still imports kit base; tsconfig is self-contained
// by necessity (neither TS nor Playwright's loader resolves a cross-package `extends` from
// inside the published preset — see the header comment on tsconfig/sveltekit.json).
describe('presets layer on kit base where resolution allows', () => {
	it('eslint preset is internalized: composes kit base + svelte delta, no kit/eslint/sveltekit re-export', () => {
		const source = read_file(ESLINT_PRESET)

		// no longer wraps kit's SvelteKit preset
		expect(source).not.toMatch(/@joshuafolkken\/kit\/eslint\/sveltekit/u)
		// composes the generic base + the generic test-filename policy by IMPORT (not clone)
		expect(source).toMatch(/create_base_config[\s\S]*from\s*'@joshuafolkken\/kit\/eslint\/base'/u)
		expect(source).toMatch(/from\s*'@joshuafolkken\/kit\/eslint\/test-filename'/u)
		// owns the Svelte plugin baseline + the SvelteKit-specific delta
		expect(source).toMatch(/from\s*'eslint-plugin-svelte'/u)
		expect(source).toMatch(/from\s*'\.\/rules\/svelte\.js'/u)
	})

	it('applies the generic test-filename rules last so route/param overrides cannot cancel the spec ban (kit#626)', () => {
		const source = read_file(ESLINT_PRESET)
		// inspect the composition body so each block name appears exactly once (its spread arg)
		const body = source.slice(source.indexOf('function create_sveltekit_config'))

		const parameter_index = body.indexOf('parameter_overrides')
		const spec_index = body.indexOf('spec_filename_overrides')
		const centralized_index = body.indexOf('centralized_tests_overrides')

		expect(parameter_index).toBeGreaterThan(-1)
		expect(spec_index).toBeGreaterThan(parameter_index)
		expect(centralized_index).toBeGreaterThan(parameter_index)
	})

	it('owns the Svelte unicorn override (no-top-level-assignment-in-function off for Svelte source)', () => {
		const source = read_file(ESLINT_PRESET)

		expect(source).toMatch(/'unicorn\/no-top-level-assignment-in-function':\s*'off'/u)
	})

	it('cspell preset imports kit base', () => {
		const source = read_file('cspell/sveltekit.yaml')

		expect(source).toMatch(/@joshuafolkken\/kit\/cspell/u)
	})

	it('tsconfig preset carries the SvelteKit compiler delta', () => {
		const source = read_file(TSCONFIG_PRESET)

		expect(source).toMatch(/"rewriteRelativeImportExtensions":\s*true/u)
		expect(source).toMatch(/"checkJs":\s*true/u)
	})
})

// #113: Playwright (>= 1.62) appends `.json` to every tsconfig `extends` entry that does not already
// end in it, then hard-throws when the resulting path is missing — so the retired `.jsonc` preset
// resolved to `*.jsonc.json` and killed the E2E suite at config load. These lock the extension for
// the published preset, the export map, and app-kit's own root tsconfig alike; a tsconfig is parsed
// as JSONC regardless of extension, so the preset keeps its comments.
describe('tsconfig preset extension (#113)', () => {
	it('ships no retired .jsonc preset beside the .json one', () => {
		expect(existsSync(TSCONFIG_PRESET)).toBe(true)
		expect(existsSync('tsconfig/sveltekit.jsonc')).toBe(false)
	})

	// A `.json` preset keeps its comments, but the editor's JSON language service flags every one of
	// them until the file is associated with jsonc. kit ships this association, yet its settings merge
	// is create-only per top-level key — app-kit already owns `files.associations` (for tailwindcss),
	// so kit's entry can never reach here and the association has to be declared locally.
	it('associates the tsconfig presets with jsonc so the editor accepts their comments', () => {
		const settings = JSON.parse(read_file(VSCODE_SETTINGS)) as Record<
			string,
			Record<string, string>
		>

		expect(settings[ASSOCIATIONS_KEY]?.[TSCONFIG_ASSOCIATION_GLOB]).toBe('jsonc')
	})

	it("app-kit's own root tsconfig extends the .json preset", () => {
		const { extends: extends_list } = JSON.parse(read_file(ROOT_TSCONFIG)) as RootTsconfig

		expect(extends_list).toContain(TSCONFIG_PRESET)
	})
})

// Issue #58: SvelteKit page-option exports (ssr/csr/prerender) are framework-reserved
// boolean names whose spelling is fixed by the contract, so they can never satisfy
// unicorn/consistent-boolean-name's is_/has_ prefix. app-kit appends a route-scoped
// scope-off for these names; non-reserved route booleans stay strict. The preset is a
// hand-authored .js that imports kit's untyped eslint subpath, so it is asserted via
// source text (matching the preset tests above) rather than executed — importing it
// would drag the untyped module into the typed test program.
describe('SvelteKit reserved route boolean exports (#58)', () => {
	it('appends a route-scoped consistent-boolean-name override ignoring ssr/csr/prerender', () => {
		const source = read_file(ESLINT_PRESET)

		// the route globs are single-sourced as SVELTE_FILE_PATTERNS.routes; the boolean
		// override scopes itself to them (internalized form — no inline duplicate literal)
		expect(source).toMatch(
			/routes:\s*\[\s*'src\/routes\/\*\*\/\+\*\.ts',\s*'src\/routes\/\*\*\/\+\*\.js'\s*\]/u,
		)
		expect(source).toMatch(
			/route_boolean_name_overrides\s*=\s*\{\s*files:\s*SVELTE_FILE_PATTERNS\.routes/u,
		)
		expect(source).toMatch(/'unicorn\/consistent-boolean-name':\s*\['error',\s*\{\s*ignore:/u)
		expect(source).toMatch(/'\^ssr\$',\s*'\^csr\$',\s*'\^prerender\$'/u)
	})
})

// Issue #65: the reserved-boolean-name list is single-sourced for consumers. game-kit lints a
// verbatim route mirror at `templates/src/routes/**` that lives outside app-kit's `src/routes/**`
// glob, so it must apply the same scope-off itself — and without an export it would clone the
// literal `['^ssr$', '^csr$', '^prerender$']` (see game-kit#364). Exporting the constant lets the
// consumer import it. Asserted via source text for the same reason as the #58 block above:
// importing the untyped preset would drag it into the typed test program.
describe('SvelteKit reserved route boolean export surface (#65)', () => {
	it('exports SVELTEKIT_RESERVED_BOOLEAN_OPTIONS from the preset entrypoint', () => {
		const source = read_file(ESLINT_PRESET)

		// exported alongside create_sveltekit_config so consumers single-source it (no clone)
		expect(source).toMatch(/export\s*\{[^}]*\bSVELTEKIT_RESERVED_BOOLEAN_OPTIONS\b[^}]*\}/u)
		// the exported constant still holds the reserved SvelteKit page-option names
		expect(source).toMatch(
			/const\s+SVELTEKIT_RESERVED_BOOLEAN_OPTIONS\s*=\s*\['\^ssr\$',\s*'\^csr\$',\s*'\^prerender\$'\]/u,
		)
	})
})

// #94 / #97: the unified `verify` command (build once → boot once → E2E + ZAP scan) is expensive,
// so its placement and glob are load-bearing. It must stay off pre-commit, its UNION glob must
// fire for both E2E and every DAST-relevant file, and it must forward the pushed files so verify
// can gate the ~34s scan narrowly (the scan-gating itself is tested in verify.test.ts).
describe('SvelteKit lefthook preset — unified verify command (#94, #97)', () => {
	it('runs the unified verify command on pre-push, never pre-commit', () => {
		const source = read_lefthook_preset()
		const pre_push_index = source.indexOf('pre-push:')
		const verify_index = source.indexOf('verify:')

		// A minutes-long build + boot + E2E + scan on every commit trains contributors into habitual
		// --no-verify, which disables every hook including the cheap ones.
		expect(verify_index).toBeGreaterThan(pre_push_index)
	})

	it('includes the broad E2E trigger verbatim so its per-file behavior is unchanged', () => {
		expect(read_lefthook_preset()).toContain(`- '{*.{svelte,ts,js,mjs,cjs},package.json}'`)
	})

	it('forwards the pushed file list so verify can gate the scan narrowly', () => {
		// The scan is gated in verify.ts (is_dast_relevant); lefthook just hands verify the files.
		expect(read_lefthook_preset()).toContain('pnpm josh-app verify {push_files}')
	})

	it('keeps the lefthook DAST glob and verify.ts is_dast_relevant in lockstep', () => {
		// The union glob fires verify; is_dast_relevant then decides whether to scan. If a
		// header/cookie file is added to one representation but not the other, the scan silently
		// never runs (or verify never fires) — the exact "gate disabled without noticing" failure
		// this pairing guards against. Adding a DAST file requires updating both, and this list.
		// Also covers +server.ts / +*.server.ts, the only place a route sets its own Set-Cookie.
		const source = read_lefthook_preset()

		for (const [glob_entry, sample] of DAST_GLOB_SAMPLES) {
			expect(source).toContain(glob_entry)
			expect(app_verify.is_dast_relevant(sample)).toBe(true)
		}
	})
})

// #96: zap-baseline.conf baselines ZAP 10055's "style-src unsafe-inline" sub-alert (required by
// SvelteKit for transitions). A rule-level IGNORE would also hide 10055's DANGEROUS sub-alerts, so
// this test is the real guard: it pins the SCRIPT surface — the actual XSS vector — locked.
describe('CSP keeps the script surface locked (#96)', () => {
	it("pins script-src to exactly ['self'] — no unsafe-inline or wildcard can slip in unnoticed", () => {
		const source = read_file(SVELTE_CONFIG)

		// `['self', 'unsafe-inline']` or `['*']` would not contain the exact `['self']` substring.
		expect(source).toContain("'script-src': ['self']")
		expect(source).toContain("'object-src': ['none']")
	})
})

// #95: k6 load-test scenarios run in k6's own runtime — they MUST `export default function` and
// import `k6/http`, both of which the kit rules reject. The preset globally ignores k6/** so a
// consumer's seeded scenario lints clean, not just app-kit's own.
describe('k6 load-test scenarios are exempt from lint (#95)', () => {
	it('the SvelteKit ESLint preset globally ignores k6/**', () => {
		expect(read_file(ESLINT_PRESET)).toContain("ignores: ['k6/**']")
	})
})
