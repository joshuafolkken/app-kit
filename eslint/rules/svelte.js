// app-kit-owned SvelteKit ESLint delta (rule definitions).
//
// Moved here from @joshuafolkken/kit's internal `eslint/rules/svelte.js` as part of
// epic #9 Phase C (issue #52): app-kit now owns the SvelteKit-specific ESLint surface.
// kit deletes its copy in kit#623 / kit#601, so this is a single-source ownership
// transfer (exactly one owner once kit strips its sveltekit preset), not a clone.

const ROUTE_HANDLER_NAMES = '/^(GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD|load|actions|fallback)$/u'

// Route handlers (GET/POST/.../load/actions/fallback) may use SvelteKit's idiomatic
// typed-const arrow form; any other named arrow const export is banned.
// `id.type="Identifier"` prevents misfiring on destructured exports.
const NON_HANDLER_ARROW_EXPORT_SELECTOR = `ExportNamedDeclaration > VariableDeclaration > VariableDeclarator[id.type="Identifier"][init.type="ArrowFunctionExpression"]:not([id.name=${ROUTE_HANDLER_NAMES}])`

const ROUTE_NO_RESTRICTED_SYNTAX = [
	'error',
	{
		selector: 'ForInStatement',
		message:
			'for..in loops iterate over the entire prototype chain, which is virtually never what you want. Use Object.{keys,values,entries}, and iterate over the resulting array.',
	},
	{
		selector: 'LabeledStatement',
		message:
			'Labels are a form of GOTO; using them makes code confusing and hard to maintain and understand.',
	},
	{
		selector: 'WithStatement',
		message:
			'`with` is disallowed in strict mode because it makes code impossible to predict and optimize.',
	},
	{
		selector: NON_HANDLER_ARROW_EXPORT_SELECTOR,
		message:
			'Only SvelteKit route handlers (GET/POST/PUT/DELETE/PATCH/OPTIONS/HEAD/load/actions/fallback) may use the typed-const arrow form. Other exports must use function syntax: `export function name() {}`.',
	},
]

const svelte_rules = {
	// Accessibility / correctness rules kept strict.
	'svelte/valid-compile': 'error',
	'svelte/no-at-html-tags': 'error',
	'svelte/no-dom-manipulating': 'error',
	'svelte/require-optimized-style-attribute': 'error',

	// Do not force path resolution on navigation.
	'svelte/no-navigation-without-resolve': [
		'error',
		{
			ignoreLinks: true,
		},
	],
}

export { ROUTE_NO_RESTRICTED_SYNTAX, svelte_rules }
