// app-kit owns the SvelteKit ESLint preset, internalized (issue #52, epic #9 Phase C).
//
// Composes kit's GENERIC building blocks with app-kit's own SvelteKit delta:
//   - kit `eslint/base` (create_base_config): generic, any-project rules. Stays in kit.
//   - eslint-plugin-svelte recommended/prettier: the Svelte plugin baseline.
//   - app-kit's `./rules/svelte.js` delta + the inline overrides below: SvelteKit-specific
//     knowledge that used to live in kit's `create_sveltekit_config`. Moved here as the
//     single owner (kit deletes its copy in kit#623 / kit#601) — a transfer, not a clone.
//   - kit `eslint/test-filename` (spec / centralized-tests bans): GENERIC test-naming policy
//     (kit #593) that kit KEEPS. Imported (not cloned) and applied LAST so flat-config
//     later-wins ordering stops the spec ban from being cancelled by the route/param
//     `no-restricted-syntax` overrides above it (see kit#626).
//
// Consumers import `@joshuafolkken/app-kit/eslint/sveltekit`.
import { create_base_config } from '@joshuafolkken/kit/eslint/base'
import {
	CENTRALIZED_TESTS_DIRECTORY_PATTERNS,
	centralized_tests_directory_rules,
	SPEC_FILENAME_PATTERNS,
	spec_filename_rules,
} from '@joshuafolkken/kit/eslint/test-filename'
import svelte from 'eslint-plugin-svelte'
import { defineConfig } from 'eslint/config'
import ts from 'typescript-eslint'
import { ROUTE_NO_RESTRICTED_SYNTAX, svelte_rules } from './rules/svelte.js'

const SVELTE_COMPONENT_PATTERN = '**/*.svelte'
const SVELTE_TS_PATTERN = '**/*.svelte.ts'

const SVELTE_FILE_PATTERNS = {
	// Real Svelte source modules — get the Svelte parser config (test files excluded:
	// plain TS that would otherwise hit the projectService/project parser conflict).
	svelte_source: [SVELTE_COMPONENT_PATTERN, SVELTE_TS_PATTERN],
	// All Svelte-paired files including tests — get the filename / rule conventions.
	svelte_named: [
		SVELTE_COMPONENT_PATTERN,
		SVELTE_TS_PATTERN,
		'**/*.svelte.test.ts',
		'**/*.svelte.spec.ts',
	],
	hooks: ['**/hooks/**/*.svelte.ts', '**/*State.svelte.ts'],
	routes: ['src/routes/**/+*.ts', 'src/routes/**/+*.js'],
	params: ['src/params/**/*.ts'],
	phrases: ['**/phrases/collections/*.ts', '**/phrases/praise.ts'],
}

const HOOK_MAX_LINES = 150
const HOOK_MAX_STATEMENTS = 15

const SVELTEKIT_ROUTE_PATTERNS = [
	String.raw`\+page\.svelte$`,
	String.raw`\+layout\.svelte$`,
	String.raw`\+error\.svelte$`,
	String.raw`\+server\.ts$`,
]

// SvelteKit page-option exports (ssr/csr/prerender) are framework-reserved boolean names
// whose spelling is fixed by the SvelteKit contract, so they can never take the
// is_/has_ prefix that unicorn/consistent-boolean-name requires. Scope the rule off for
// these names in route files only; non-reserved route booleans stay strict. (Issue #58.)
//
// AC3 (#52) — consistent-boolean-name crash boundary: the ESLint crash that motivated #52
// was an eslint-plugin-unicorn@68 bug, fixed upstream in unicorn 69. The rule itself is
// GENERIC (compatible with the kit's is_/has_ snake_case booleans) and stays in kit base;
// app-kit owns only this SvelteKit-route reserved-name relaxation.
const SVELTEKIT_RESERVED_BOOLEAN_OPTIONS = ['^ssr$', '^csr$', '^prerender$']

// SvelteKit's ambient declarations file uses external-contract binding names and the
// `export {}` module marker, which never follow the kit's naming/export rules (kit #474).
const ignore_ambient_types = { ignores: ['src/app.d.ts'] }

const svelte_named_overrides = {
	files: SVELTE_FILE_PATTERNS.svelte_named,
	rules: {
		'unicorn/filename-case': [
			'error',
			{ case: 'pascalCase', ignore: SVELTEKIT_ROUTE_PATTERNS, checkDirectories: false },
		],
		'sonarjs/no-unused-collection': 'off',
		// {@render snippet()} is a template directive, not a value-consuming expression.
		'sonarjs/no-use-of-empty-return-value': 'off',
		// Reassigning a top-level let/$state from an event handler or effect is the intended
		// Svelte 5 reactivity model; unicorn has no rune awareness and misreads it as a hidden
		// module-singleton mutation. Off for Svelte source. (Owned + fixture-guarded: #52 AC2/AC4,
		// guard: src/lib/lint-guards/RuneReassignGuard.svelte.ts.)
		'unicorn/no-top-level-assignment-in-function': 'off',
		...svelte_rules,
	},
}

const hook_overrides = {
	files: SVELTE_FILE_PATTERNS.hooks,
	rules: {
		'prefer-const': 'off',
		'max-lines-per-function': ['error', HOOK_MAX_LINES],
		'max-statements': ['error', HOOK_MAX_STATEMENTS],
	},
}

const route_overrides = {
	files: SVELTE_FILE_PATTERNS.routes,
	rules: { 'no-restricted-syntax': ROUTE_NO_RESTRICTED_SYNTAX },
}

const parameter_overrides = {
	files: SVELTE_FILE_PATTERNS.params,
	rules: { 'unicorn/filename-case': 'off', 'no-restricted-syntax': 'off' },
}

const phrase_overrides = {
	files: SVELTE_FILE_PATTERNS.phrases,
	rules: { 'max-lines': 'off', 'sonarjs/no-duplicate-string': 'off' },
}

const route_boolean_name_overrides = {
	files: SVELTE_FILE_PATTERNS.routes,
	rules: {
		'unicorn/consistent-boolean-name': ['error', { ignore: SVELTEKIT_RESERVED_BOOLEAN_OPTIONS }],
	},
}

// Generic test-filename enforcement (kit #593) — applied LAST so the later-wins flat-config
// order keeps the *.spec ban effective even for files matched by the route/param
// `no-restricted-syntax` overrides above (kit#626). Imported from kit, never cloned.
const spec_filename_overrides = { files: SPEC_FILENAME_PATTERNS, rules: spec_filename_rules }
const centralized_tests_overrides = {
	files: CENTRALIZED_TESTS_DIRECTORY_PATTERNS,
	rules: centralized_tests_directory_rules,
}

/**
 * @param {unknown} svelte_config
 * @returns {import('eslint').Linter.Config}
 */
function svelte_parser_overrides(svelte_config) {
	return {
		files: SVELTE_FILE_PATTERNS.svelte_source,
		languageOptions: {
			parserOptions: {
				projectService: true,
				extraFileExtensions: ['.svelte'],
				parser: ts.parser,
				svelteConfig: svelte_config,
			},
		},
	}
}

/**
 * @param {{ gitignore_path: URL, tsconfig_root_dir: string, svelte_config?: unknown }} options
 * @returns {import('eslint').Linter.Config[]}
 */
function create_sveltekit_config(options) {
	const { gitignore_path, tsconfig_root_dir, svelte_config } = options

	return defineConfig(
		...create_base_config({ gitignore_path, tsconfig_root_dir }),
		ignore_ambient_types,
		...svelte.configs.recommended,
		...svelte.configs.prettier,
		svelte_parser_overrides(svelte_config),
		svelte_named_overrides,
		hook_overrides,
		route_overrides,
		parameter_overrides,
		phrase_overrides,
		route_boolean_name_overrides,
		spec_filename_overrides,
		centralized_tests_overrides,
	)
}

export { create_sveltekit_config }
