import { expect, test } from '@playwright/test'

// The heading text, not merely "an h1 is visible" (app-kit#137). When the pre-push gate was pointed
// at a different application by accident, this test still passed — that app's `404 Not Found` page had
// an h1 too, which virtually every HTML document does. Pinning the text is what makes a pass evidence
// that THIS page rendered.
const DEMO_HEADING = 'Playwright e2e test demo'

test('renders the demo page heading', async ({ page }) => {
	await page.goto('/demo/playwright')
	await expect(page.locator('h1')).toHaveText(DEMO_HEADING)
})

test('hydrates and stays interactive under the Content-Security-Policy', async ({ page }) => {
	// If the CSP (svelte.config.js kit.csp) blocked SvelteKit's hydration script, the button's
	// click handler would never wire up and the count would stay at 0. Incrementing it proves the
	// client script ran — i.e. the CSP nonces the inline hydration script rather than refusing it.
	const violations: Array<string> = []
	page.on('console', (message) => {
		if (message.text().includes('Content Security Policy')) violations.push(message.text())
	})

	await page.goto('/demo/playwright')
	const counter = page.getByTestId('counter')
	await expect(counter).toHaveText('count is 0')

	await counter.click()
	await expect(counter).toHaveText('count is 1')

	expect(violations, violations.join('\n')).toHaveLength(0)
})
