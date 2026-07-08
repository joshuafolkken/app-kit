import { describe, expect, it } from 'vitest'
import { config_patch } from './config-patch.js'

const KIT_ESLINT_MODULE = '@joshuafolkken/kit/eslint/vanilla'
const APP_KIT_ESLINT_MODULE = '@joshuafolkken/app-kit/eslint/sveltekit'
const KIT_ESLINT_FACTORY = 'create_vanilla_config'
const APP_KIT_ESLINT_FACTORY = 'create_sveltekit_config'

const CONSUMER_RULE = "'no-console': 'error'"

// The framework-agnostic ESLint config kit's `josh init` scaffolds — the state app-kit's overlay
// migrates to the SvelteKit preset.
const ESLINT_KIT_VANILLA = `import { ${KIT_ESLINT_FACTORY} } from '${KIT_ESLINT_MODULE}'

export default ${KIT_ESLINT_FACTORY}({
	gitignore_path: new URL('./.gitignore', import.meta.url),
	tsconfig_root_dir: import.meta.dirname,
})
`

// kit's vanilla scaffold after a consumer appended a local rules block (kit's merge_eslint_config
// layout). The migration must swap both factory references while preserving the rules block verbatim.
const ESLINT_KIT_VANILLA_WITH_RULES = `import { ${KIT_ESLINT_FACTORY} } from '${KIT_ESLINT_MODULE}'

export default [
	...${KIT_ESLINT_FACTORY}({
		gitignore_path: new URL('./.gitignore', import.meta.url),
		tsconfig_root_dir: import.meta.dirname,
	}),
	{
		rules: {
			${CONSUMER_RULE},
		},
	},
]
`

// A consumer's own ESLint config that never referenced the kit vanilla preset — left untouched.
const ESLINT_CONSUMER_CUSTOM = `export default [
	{
		rules: {
			${CONSUMER_RULE},
		},
	},
]
`

// The migration's on-disk wiring through patch_configs is covered end-to-end by sync.test.ts
// ('migrates a kit vanilla eslint.config.js ...' exercises apply_overlay -> patch_configs); these
// cases pin the pure content transform.
describe('config patch — eslint.config.js', () => {
	it('migrates the kit vanilla import + factory to the app-kit sveltekit preset, preserving options', () => {
		const patched = config_patch.patch_eslint_content(ESLINT_KIT_VANILLA)

		expect(patched).toContain(`from '${APP_KIT_ESLINT_MODULE}'`)
		expect(patched).toContain(`${APP_KIT_ESLINT_FACTORY}({`)
		expect(patched).not.toContain(KIT_ESLINT_MODULE)
		expect(patched).not.toContain(KIT_ESLINT_FACTORY)
		expect(patched).toContain('gitignore_path: new URL')
		expect(patched).toContain('tsconfig_root_dir: import.meta.dirname')
	})

	it('preserves an appended consumer rules block through the swap', () => {
		const patched = config_patch.patch_eslint_content(ESLINT_KIT_VANILLA_WITH_RULES)

		expect(patched).toContain(`...${APP_KIT_ESLINT_FACTORY}({`)
		expect(patched).not.toContain(KIT_ESLINT_FACTORY)
		expect(patched).toContain(CONSUMER_RULE)
	})

	it('leaves a consumer config without the kit vanilla marker untouched', () => {
		expect(config_patch.patch_eslint_content(ESLINT_CONSUMER_CUSTOM)).toBe(ESLINT_CONSUMER_CUSTOM)
	})

	it('is idempotent — a second pass on the migrated config is a no-op', () => {
		const once = config_patch.patch_eslint_content(ESLINT_KIT_VANILLA)

		expect(config_patch.patch_eslint_content(once)).toBe(once)
	})
})
