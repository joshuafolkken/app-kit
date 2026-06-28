// app-kit owns the SvelteKit ESLint preset surface.
//
// Transitional: this wraps @joshuafolkken/kit's `create_sveltekit_config`
// rather than forking it. kit's SvelteKit delta depends on kit-internal,
// unexported rule modules, so app-kit cannot compose `base + delta` in-house
// yet. Instead it imports kit's config and appends one app-layer override
// (later-wins flat-config ordering). True internalization happens once kit
// exposes its eslint rule building blocks (precondition: joshuafolkken/kit#601,
// tracked by #52).
//
// Consumers import `@joshuafolkken/app-kit/eslint/sveltekit` instead of
// `@joshuafolkken/kit/eslint/sveltekit`.
import { create_sveltekit_config as create_kit_sveltekit_config } from '@joshuafolkken/kit/eslint/sveltekit'

// SvelteKit page-option exports (ssr/csr/prerender) are framework-reserved boolean
// names whose spelling is fixed by the SvelteKit contract, so they can never take
// the is_/has_ prefix that unicorn/consistent-boolean-name requires. Scope the rule
// off for these names in route files only; non-reserved route booleans stay strict.
const SVELTEKIT_RESERVED_BOOLEAN_OPTIONS = ['^ssr$', '^csr$', '^prerender$']
const route_boolean_name_overrides = {
	files: ['src/routes/**/+*.ts', 'src/routes/**/+*.js'],
	rules: {
		'unicorn/consistent-boolean-name': ['error', { ignore: SVELTEKIT_RESERVED_BOOLEAN_OPTIONS }],
	},
}

/**
 * @param {Parameters<typeof create_kit_sveltekit_config>[0]} options
 * @returns {import('eslint').Linter.Config[]}
 */
function create_sveltekit_config(options) {
	return [...create_kit_sveltekit_config(options), route_boolean_name_overrides]
}

export { create_sveltekit_config }
