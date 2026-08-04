import { config_merge } from '@joshuafolkken/kit/config-merge'
import { patch_file } from './patch-file.js'
import type { OverlayChange } from './sync.js'

const CSPELL_FILE = 'cspell.config.yaml'
const TSCONFIG_FILE = 'tsconfig.json'
const LEFTHOOK_FILE = 'lefthook.yml'
const ESLINT_FILE = 'eslint.config.js'
const NPMRC_FILE = '.npmrc'

const CSPELL_IMPORT_FIELD = 'import'
const CSPELL_IGNORE_FIELD = 'ignorePaths'
const TSCONFIG_EXTENDS_FIELD = 'extends'
const LEFTHOOK_EXTENDS_FIELD = 'extends'

// The layered-ownership boundary: kit owns the framework-agnostic base line, app-kit owns the
// SvelteKit line. The patcher ensures app-kit's line and removes any kit-emitted SvelteKit line,
// so the two tools never write the same field to different values. The `remove` patterns match
// `*/sveltekit` regardless of the consumer's path prefix / extension, but the `(?![\w-])` tail
// anchors `sveltekit` to a complete path segment — kit's `tsconfig/base` line and any unrelated
// `sveltekit-*` entry are left untouched.
const APP_KIT_CSPELL_IMPORT = '@joshuafolkken/app-kit/cspell/sveltekit'
const KIT_CSPELL_SVELTEKIT = /@joshuafolkken\/kit\/cspell\/sveltekit(?![\w-])/u
// kit#601 made kit's base cspell merge framework-agnostic, so `josh init` / `josh sync` now always
// ensures the bare `@joshuafolkken/kit/cspell` base — even when the app-kit preset (which already
// re-exports that base) is present, leaving a redundant line. The app-kit preset is the sole owner
// of the SvelteKit cspell config, so when it is ensured we also strip the now-redundant base. The
// `(?![\w/-])` tail anchors `cspell` to a complete path segment, so the `/cspell/sveltekit` line and
// any `cspell-*` sibling are left for their own matchers.
const KIT_CSPELL_BASE = /@joshuafolkken\/kit\/cspell(?![\w/-])/u
// The package-export subpath, not a raw `node_modules` path. A raw path pins every consumer to the
// preset's current file name, which is exactly what broke them at the `.jsonc` → `.json` rename
// (#113): the entry they carried no longer existed. The export subpath is immune to the next rename
// because the mapping lives in app-kit's own `exports` field. Verified to resolve for a consumer's
// root tsconfig — `tsc --showConfig` applies the preset in full (no TS6053), and Playwright 1.62
// lists its suite, so neither the type-check nor the E2E path regresses (#141).
const APP_KIT_TSCONFIG_EXTENDS = '@joshuafolkken/app-kit/tsconfig/sveltekit'
// Every file-path spelling of the same preset, retired in favour of the export subpath above: the
// raw `node_modules` path (with or without a `./` prefix) and the pre-#113 `.jsonc` name, which
// Playwright (>= 1.62) hard-throws on because it appends `.json` and finds nothing there.
//
// These have to be *removed*, not merely out-competed by `ensure`. Each is a different string from
// the export subpath, so `ensure` alone would append the subpath beside them — stacking a duplicate
// on a consumer who had hardened their config, and leaving the fatal `.jsonc` line in place for one
// who had not (#141, #113, joshuafolkken/game-kit#415). Removal is what makes the pass a migration.
//
// The trailing `\.jsonc?$` is what keeps this from matching the subpath it replaces: the subpath
// carries no extension, so it can never be removed by the same pass that ensures it. Removal is
// unconditional (unlike kit's existence-gated rewrite, which must span packages) because the sync
// doing it ships from the very app-kit version that carries the replacement preset.
const APP_KIT_TSCONFIG_FILE_PATH = /@joshuafolkken\/app-kit\/tsconfig\/sveltekit\.jsonc?$/u
const KIT_TSCONFIG_SVELTEKIT = /@joshuafolkken\/kit\/tsconfig\/sveltekit(?![\w-])/u
// kit's `josh sync` / `josh init` unconditionally ensures the framework-agnostic base entry
// (`kit/tsconfig/base.jsonc`), even when the app-kit SvelteKit preset is present. The preset is
// self-contained (repeats every base option) and, being later in the `extends` array, always wins,
// so the base entry is inert — the app-kit preset is the sole owner of the SvelteKit tsconfig, so
// when it is ensured we also strip the now-redundant base. The `(?![\w-])` tail anchors `base` to a
// complete path segment, so the `/tsconfig/sveltekit` line and any `base-*` sibling are untouched.
const KIT_TSCONFIG_BASE = /@joshuafolkken\/kit\/tsconfig\/base(?![\w-])/u
// lefthook references presets as raw root-relative node_modules paths (not package-export
// subpaths), so the swap mirrors the kit→app-kit extends migration. `front` matches the
// `extends`-first layout `josh init` emits; the regex anchors `sveltekit` to a full path
// segment so an unrelated `sveltekit-*` entry is left untouched.
const APP_KIT_LEFTHOOK_EXTENDS = 'node_modules/@joshuafolkken/app-kit/lefthook/sveltekit.yml'
const KIT_LEFTHOOK_SVELTEKIT = /@joshuafolkken\/kit\/lefthook\/sveltekit(?![\w-])/u
// kit's `josh sync` / `josh init` unconditionally ensures the base entry (`kit/lefthook/vanilla.yml`),
// even when the app-kit SvelteKit preset is present. Both `vanilla.yml` and the app-kit preset only
// `extends: kit/lefthook/base.yml`, so the base is pulled in twice and the vanilla entry adds no
// commands — the app-kit preset is the sole owner of the SvelteKit lefthook config, so when it is
// ensured we also strip the now-redundant vanilla entry. The `(?![\w-])` tail anchors `vanilla` to a
// complete path segment, so the `/lefthook/sveltekit` line and any `vanilla-*` sibling are untouched.
const KIT_LEFTHOOK_VANILLA = /@joshuafolkken\/kit\/lefthook\/vanilla(?![\w-])/u
const LEFTHOOK_EXTENDS_POSITION = 'front' as const

// eslint.config.js is executable JS, not a JSON / YAML list field, so config_merge's list patchers
// do not apply — the migration is a targeted import-specifier + factory-identifier swap. kit's
// `josh init` scaffolds the framework-agnostic vanilla config (`create_vanilla_config` from
// `kit/eslint/vanilla`); app-kit owns the SvelteKit layer, so the overlay swaps it to
// `create_sveltekit_config` from `app-kit/eslint/sveltekit`. Both factories take the same options
// object ({ gitignore_path, tsconfig_root_dir }), so only the specifier and the identifier change —
// the consumer's options body and any appended `rules` block are preserved verbatim. Guarded on the
// kit module marker so a consumer's own config (or an already-migrated one) is left untouched,
// keeping the patch idempotent.
const KIT_ESLINT_MODULE = '@joshuafolkken/kit/eslint/vanilla'
const APP_KIT_ESLINT_MODULE = '@joshuafolkken/app-kit/eslint/sveltekit'
const KIT_ESLINT_FACTORY = 'create_vanilla_config'
const APP_KIT_ESLINT_FACTORY = 'create_sveltekit_config'

// The GitHub Packages credential line, and the key it sets. kit owns `.npmrc`'s framework-agnostic
// lines and deliberately does not distribute this one (joshuafolkken/kit#759): a consumer with no
// `npmrcAuthFile` opt-in gains nothing from it. app-kit's consumers deploy to Cloudflare Workers
// Builds, which is exactly the arrangement where the line is live, so the app-kit layer owns it —
// the same kit-base / app-kit-overlay split the cspell and tsconfig lines above follow.
//
// The line alone authenticates nothing. Measured on pnpm 11.20.0 with the user config isolated:
// pnpm ignores a project-level credential unless the trusted-auth-file opt-in is declared from
// OUTSIDE the repository (`PNPM_CONFIG_NPMRC_AUTH_FILE=.npmrc`) — declaring `npmrcAuthFile` in the
// project `.npmrc` itself or in `pnpm-workspace.yaml` does not count, since a committed file that
// could vouch for itself would void the protection. So app-kit can ship the credential but never
// the switch; without the switch the line is inert and pnpm prints an `Ignored project-level auth
// setting` warning. README documents both variables.
//
// Appending is durable: kit's `merge_npmrc` has been insert-only since kit#759, and `josh-app sync`
// runs kit's base before this overlay, so the line survives every subsequent sync.
//
// The key is the unit the scan matches on, so the emitted line is composed from it rather than
// spelled out twice: a consumer who set this token some other way (a literal value, a different
// variable) already owns the setting, and appending ours beside it would leave two lines writing
// the same key. Presence of the key in any form is the signal to stand down.
const NPMRC_AUTH_KEY = '//npm.pkg.github.com/:_authToken='
// Single-quoted: `${NODE_AUTH_TOKEN}` is the literal placeholder pnpm expands, not a TS template.
const NPMRC_AUTH_VALUE = '${NODE_AUTH_TOKEN}'
const NPMRC_AUTH_LINE = `${NPMRC_AUTH_KEY}${NPMRC_AUTH_VALUE}`

// SvelteKit + Cloudflare build artifacts a consumer should never spell-check. The app-kit preset
// now single-sources these (via position-independent `**/<dir>/**` globs that propagate through the
// import), so sync no longer clones them into the consumer's local ignorePaths and instead strips
// any redundant copies an earlier sync left behind — converging every consumer on the import.
const CSPELL_REDUNDANT_IGNORE_PATHS: ReadonlyArray<string> = ['.svelte-kit/**', '.wrangler/**']

// cspell places the `import` block right after `version`; emit double-quoted scalars to match the
// VSCode cspell extension (and kit's own sync output), avoiding quote churn.
const CSPELL_IMPORT_POSITION = { after: 'version' } as const
const CSPELL_QUOTE_STYLE = 'double' as const

function patch_cspell_content(content: string): string {
	const with_import = config_merge.patch_yaml_list_field(content, {
		field: CSPELL_IMPORT_FIELD,
		ensure: [APP_KIT_CSPELL_IMPORT],
		remove: [KIT_CSPELL_SVELTEKIT, KIT_CSPELL_BASE],
		position: CSPELL_IMPORT_POSITION,
		quote_style: CSPELL_QUOTE_STYLE,
	})

	return config_merge.patch_yaml_list_field(with_import, {
		field: CSPELL_IGNORE_FIELD,
		remove: CSPELL_REDUNDANT_IGNORE_PATHS,
		quote_style: CSPELL_QUOTE_STYLE,
	})
}

function patch_tsconfig_content(content: string): string {
	return config_merge.patch_json_list_field(content, {
		field: TSCONFIG_EXTENDS_FIELD,
		ensure: [APP_KIT_TSCONFIG_EXTENDS],
		remove: [KIT_TSCONFIG_SVELTEKIT, KIT_TSCONFIG_BASE, APP_KIT_TSCONFIG_FILE_PATH],
	})
}

function patch_lefthook_content(content: string): string {
	return config_merge.patch_yaml_list_field(content, {
		field: LEFTHOOK_EXTENDS_FIELD,
		ensure: [APP_KIT_LEFTHOOK_EXTENDS],
		remove: [KIT_LEFTHOOK_SVELTEKIT, KIT_LEFTHOOK_VANILLA],
		position: LEFTHOOK_EXTENDS_POSITION,
	})
}

// Migrate kit's vanilla ESLint scaffold to app-kit's SvelteKit preset. Only the kit import specifier
// and the factory identifier are swapped; the options body and any consumer `rules` block are kept.
// Function replacers so a `$` in surrounding content is never read as a replacement token. Guarded so
// a config without the kit vanilla marker (a consumer's own, or an already-migrated one) is a no-op.
function patch_eslint_content(content: string): string {
	if (!content.includes(KIT_ESLINT_MODULE)) return content

	return content
		.replaceAll(KIT_ESLINT_MODULE, () => APP_KIT_ESLINT_MODULE)
		.replaceAll(KIT_ESLINT_FACTORY, () => APP_KIT_ESLINT_FACTORY)
}

// A line-oriented ini file, so config_merge's YAML / JSON list patchers do not apply — the scan is
// per-line rather than a substring search of the whole file. Leading whitespace and ini comment
// markers are stripped before matching, which makes a commented-out entry the opt-out: a consumer
// who authenticates some other way (the `npm_config_//npm.pkg.github.com/:_authToken` build
// variable) comments the line out to silence pnpm's warning, and no later sync re-adds it.
const NPMRC_LEADING_NOISE = /^[\s#;]*/u

function has_auth_setting(content: string): boolean {
	return content
		.split('\n')
		.some((line) => line.replace(NPMRC_LEADING_NOISE, '').startsWith(NPMRC_AUTH_KEY))
}

// Append the credential line when the consumer has no setting for that key. Every existing byte is
// preserved; a file that does not end in a newline gets one first, so the appended line is never
// glued onto the last entry.
function patch_npmrc_content(content: string): string {
	if (has_auth_setting(content)) return content

	const prefix = content.length > 0 && !content.endsWith('\n') ? `${content}\n` : content

	return `${prefix}${NPMRC_AUTH_LINE}\n`
}

// Reconcile the SvelteKit + Cloudflare config app-kit owns: the eslint.config.js factory swap, the
// SvelteKit-specific lines in the layered cspell / tsconfig / lefthook configs, and the GitHub
// Packages credential line in .npmrc.
function patch_configs(target: string): Array<OverlayChange> {
	return [
		patch_file(target, ESLINT_FILE, patch_eslint_content),
		patch_file(target, CSPELL_FILE, patch_cspell_content),
		patch_file(target, TSCONFIG_FILE, patch_tsconfig_content),
		patch_file(target, LEFTHOOK_FILE, patch_lefthook_content),
		patch_file(target, NPMRC_FILE, patch_npmrc_content),
	]
}

const config_patch = {
	patch_cspell_content,
	patch_tsconfig_content,
	patch_lefthook_content,
	patch_eslint_content,
	patch_npmrc_content,
	patch_configs,
}

export { config_patch }
