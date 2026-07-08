import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { config_merge } from '@joshuafolkken/kit/config-merge'
import type { OverlayChange } from './sync.js'

const ENCODING = 'utf8'
const CSPELL_FILE = 'cspell.config.yaml'
const TSCONFIG_FILE = 'tsconfig.json'
const LEFTHOOK_FILE = 'lefthook.yml'

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

type ContentPatcher = (content: string) => string

// Patch one already-existing config file in place, preserving every untouched entry. A file the
// consumer has not created yet is skipped — the orchestrated `josh sync` / `josh init` seeds the
// base first — and an already-correct file is a no-op, so re-runs report `skipped` and never
// rewrite bytes.
function patch_file(target: string, file: string, patch: ContentPatcher): OverlayChange {
	const destination = path.join(target, file)
	if (!existsSync(destination)) return { file, action: 'skipped' }

	const original = readFileSync(destination, ENCODING)
	const patched = patch(original)
	if (patched === original) return { file, action: 'skipped' }

	writeFileSync(destination, patched)

	return { file, action: 'updated' }
}

// Reconcile the SvelteKit-specific lines app-kit owns in the layered cspell / tsconfig / lefthook
// configs.
function patch_configs(target: string): Array<OverlayChange> {
	return [
		patch_file(target, CSPELL_FILE, patch_cspell_content),
		patch_file(target, TSCONFIG_FILE, patch_tsconfig_content),
		patch_file(target, LEFTHOOK_FILE, patch_lefthook_content),
	]
}

const config_patch = {
	patch_cspell_content,
	patch_tsconfig_content,
	patch_lefthook_content,
	patch_configs,
}

export { config_patch }
