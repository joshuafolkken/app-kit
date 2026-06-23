// app-kit owns the SvelteKit ESLint preset surface.
//
// Transitional: this re-exports @joshuafolkken/kit's `create_sveltekit_config`
// unchanged. kit's SvelteKit delta depends on kit-internal, unexported rule
// modules, so app-kit cannot compose `base + delta` in-house yet without forking.
// The re-export moves the consumer import surface to app-kit now; true
// internalization happens once kit exposes its eslint rule building blocks
// (tracked as a precondition on joshuafolkken/kit#601).
//
// Consumers import `@joshuafolkken/app-kit/eslint/sveltekit` instead of
// `@joshuafolkken/kit/eslint/sveltekit`.
export { create_sveltekit_config } from '@joshuafolkken/kit/eslint/sveltekit'
