<script lang="ts">
	// A hydration probe: the count only increments if the client-side script actually ran, which
	// verifies the Content-Security-Policy (svelte.config.js) does not block SvelteKit's hydration.
	let count = $state(0)
</script>

<h1>Playwright e2e test demo</h1>

<button data-testid="counter" onclick={() => (count += 1)}>count is {count}</button>
