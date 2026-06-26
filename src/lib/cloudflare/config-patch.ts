import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { config_merge } from '@joshuafolkken/kit/config-merge'
import type { OverlayChange } from './sync.js'

const ENCODING = 'utf8'
const CSPELL_FILE = 'cspell.config.yaml'
const TSCONFIG_FILE = 'tsconfig.json'

const CSPELL_IMPORT_FIELD = 'import'
const CSPELL_IGNORE_FIELD = 'ignorePaths'
const TSCONFIG_EXTENDS_FIELD = 'extends'

// The layered-ownership boundary: kit owns the framework-agnostic base line, app-kit owns the
// SvelteKit line. The patcher ensures app-kit's line and removes any kit-emitted SvelteKit line,
// so the two tools never write the same field to different values. The `remove` patterns match
// `*/sveltekit` regardless of the consumer's path prefix / extension, but the `(?![\w-])` tail
// anchors `sveltekit` to a complete path segment — kit's base `cspell` / `tsconfig/base` lines and
// any unrelated `sveltekit-*` entry are left untouched.
const APP_KIT_CSPELL_IMPORT = '@joshuafolkken/app-kit/cspell/sveltekit'
const KIT_CSPELL_SVELTEKIT = /@joshuafolkken\/kit\/cspell\/sveltekit(?![\w-])/u
const APP_KIT_TSCONFIG_EXTENDS = './node_modules/@joshuafolkken/app-kit/tsconfig/sveltekit.jsonc'
const KIT_TSCONFIG_SVELTEKIT = /@joshuafolkken\/kit\/tsconfig\/sveltekit(?![\w-])/u

// SvelteKit + Cloudflare build artifacts a consumer should never spell-check. Ensured at the
// consumer level because cspell does not reliably inherit ignorePaths from an imported config.
const CSPELL_IGNORE_PATHS: ReadonlyArray<string> = ['.svelte-kit/**', '.wrangler/**']

// cspell places the `import` block right after `version`; emit double-quoted scalars to match the
// VSCode cspell extension (and kit's own sync output), avoiding quote churn.
const CSPELL_IMPORT_POSITION = { after: 'version' } as const
const CSPELL_QUOTE_STYLE = 'double' as const

function patch_cspell_content(content: string): string {
	const with_import = config_merge.patch_yaml_list_field(content, {
		field: CSPELL_IMPORT_FIELD,
		ensure: [APP_KIT_CSPELL_IMPORT],
		remove: [KIT_CSPELL_SVELTEKIT],
		position: CSPELL_IMPORT_POSITION,
		quote_style: CSPELL_QUOTE_STYLE,
	})

	return config_merge.patch_yaml_list_field(with_import, {
		field: CSPELL_IGNORE_FIELD,
		ensure: CSPELL_IGNORE_PATHS,
		position: 'end',
		quote_style: CSPELL_QUOTE_STYLE,
	})
}

function patch_tsconfig_content(content: string): string {
	return config_merge.patch_json_list_field(content, {
		field: TSCONFIG_EXTENDS_FIELD,
		ensure: [APP_KIT_TSCONFIG_EXTENDS],
		remove: [KIT_TSCONFIG_SVELTEKIT],
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

// Reconcile the SvelteKit-specific lines app-kit owns in the layered cspell / tsconfig configs.
function patch_configs(target: string): Array<OverlayChange> {
	return [
		patch_file(target, CSPELL_FILE, patch_cspell_content),
		patch_file(target, TSCONFIG_FILE, patch_tsconfig_content),
	]
}

const config_patch = { patch_cspell_content, patch_tsconfig_content, patch_configs }

export { config_patch }
