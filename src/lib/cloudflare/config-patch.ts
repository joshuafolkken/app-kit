import { config_merge } from '@joshuafolkken/kit/config-merge'
import { patch_file } from './patch-file.js'
import type { OverlayChange } from './sync.js'

const CSPELL_FILE = 'cspell.config.yaml'
const TSCONFIG_FILE = 'tsconfig.json'
const LEFTHOOK_FILE = 'lefthook.yml'
const ESLINT_FILE = 'eslint.config.js'

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
const APP_KIT_TSCONFIG_EXTENDS = './node_modules/@joshuafolkken/app-kit/tsconfig/sveltekit.jsonc'
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
		remove: [KIT_TSCONFIG_SVELTEKIT, KIT_TSCONFIG_BASE],
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

// Reconcile the SvelteKit config app-kit owns: the eslint.config.js factory swap plus the
// SvelteKit-specific lines in the layered cspell / tsconfig / lefthook configs.
function patch_configs(target: string): Array<OverlayChange> {
	return [
		patch_file(target, ESLINT_FILE, patch_eslint_content),
		patch_file(target, CSPELL_FILE, patch_cspell_content),
		patch_file(target, TSCONFIG_FILE, patch_tsconfig_content),
		patch_file(target, LEFTHOOK_FILE, patch_lefthook_content),
	]
}

const config_patch = {
	patch_cspell_content,
	patch_tsconfig_content,
	patch_lefthook_content,
	patch_eslint_content,
	patch_configs,
}

export { config_patch }
