<script lang="ts">
	import { onMount } from 'svelte'

	// A hydration probe: the count only increments if the client-side script actually ran, which
	// verifies the Content-Security-Policy (svelte.config.js) does not block SvelteKit's hydration.
	let count = $state(0)

	// `onMount` runs only on the client, after hydration has wired the click handler up. Exposing it
	// as an attribute gives the e2e test a barrier to wait on: the server-rendered markup already
	// reads "count is 0", so the text alone cannot tell a hydrated button from an inert one, and a
	// click sent before hydration is silently dropped rather than retried (app-kit#143).
	let is_hydrated = $state(false)

	onMount(() => {
		is_hydrated = true
	})
</script>

<h1>Playwright e2e test demo</h1>

<button
	data-testid="counter"
	data-hydrated={is_hydrated ? 'true' : undefined}
	onclick={() => (count += 1)}>count is {count}</button
>
