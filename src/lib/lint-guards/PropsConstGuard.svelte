<!--
	Lint regression guard for issue #271.

	`let { … } = $props()` is the idiomatic Svelte 5 props binding (the sv scaffold's own
	+layout.svelte uses it). Core prefer-const has no rune awareness and flags it; app-kit's
	`eslint/sveltekit` preset swaps in svelte/prefer-const for Svelte source. If this file
	starts failing `pnpm josh lint`, that override has regressed.
-->
<script lang="ts">
	interface Props {
		label: string
	}

	let { label }: Props = $props()
</script>

<span>{label}</span>
