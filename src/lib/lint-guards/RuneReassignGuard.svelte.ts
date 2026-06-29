// Lint regression guard for issue #52 / kit#626.
//
// A top-level `$state` reassigned inside a function is the idiomatic Svelte 5 reactivity
// model. `unicorn/no-top-level-assignment-in-function` must stay OFF for Svelte source —
// it is owned by app-kit's `eslint/sveltekit` preset (the svelte_named override). If this
// file starts failing `pnpm josh lint`, that override has regressed.
//
// The fixture exists because app-kit's own Svelte surface is otherwise too small to catch
// this regression — the failure only surfaced in a 110-file downstream consumer (#52).

let is_active = $state(false)

function toggle_active(): void {
	is_active = !is_active
}

export { toggle_active }
