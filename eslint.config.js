import { create_sveltekit_config } from './eslint/sveltekit.js'

export default [
	...create_sveltekit_config({
		gitignore_path: new URL('./.gitignore', import.meta.url),
		tsconfig_root_dir: import.meta.dirname,
	}),
	{
		// sv-generated demo/example code + distributed templates (copied verbatim into
		// consumer scaffolds, not app-kit source) are excluded from the kit's strict rules.
		ignores: ['src/lib/vitest-examples/**', 'src/routes/demo/**', 'templates/**'],
	},
	{
		rules: {
			// typescript-eslint strongly recommend that you do not use the no-undef lint rule on TypeScript projects.
			// see: https://typescript-eslint.io/troubleshooting/faqs/eslint/#i-get-errors-from-the-no-undef-rule-about-global-variables-not-being-defined-even-though-there-are-no-typescript-errors
			'no-undef': 'off',
		},
	},
	{
		// scripts/ (the josh-app CLI) sits outside the SvelteKit tsconfig, so point ESLint
		// at scripts/tsconfig.json for type-aware rules (mirrors game-kit). tsconfigRootDir
		// is already set by the kit base config, so only the project path is overridden here.
		files: ['scripts/**/*.ts'],
		languageOptions: {
			parserOptions: {
				project: './scripts/tsconfig.json',
			},
		},
	},
]
