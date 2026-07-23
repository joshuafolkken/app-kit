import { expect, test } from '@playwright/test'

// `_headers` is a Cloudflare directive file applied by the Worker runtime — `pnpm run preview`
// and production. The vite dev server does not process it, and Playwright runs against dev
// locally (see playwright.config.ts), so this spec only carries meaning against the preview
// server, which is what CI runs and what `josh-app dast` scans. Skipping is honest here:
// asserting Worker behavior against a dev server would only produce a false failure.
const PREVIEW_PORT = '4173'

const DEV_SERVER_REASON = 'security headers come from the Worker runtime, not the vite dev server'

test('serves the security headers _headers declares', async ({ page, baseURL: base_url }) => {
	// Not a disabled test: CI runs the preview server, where this executes and must pass.
	test.skip(!base_url?.includes(PREVIEW_PORT), DEV_SERVER_REASON)

	const response = await page.goto('/')
	const headers = response?.headers() ?? {}

	// Each assertion pins a ZAP baseline finding closed by `_headers`; dropping a line in that
	// file re-opens the corresponding finding and fails `josh-app dast`.
	expect(headers['x-content-type-options']).toBe('nosniff')
	expect(headers['x-frame-options']).toBe('DENY')
	expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin')
	expect(headers['permissions-policy']).toContain('camera=()')

	// CSP is emitted by SvelteKit's kit.csp (svelte.config.js), not `_headers` — this asserts the
	// header survives the Cloudflare adapter and closes ZAP 10038 (#96). `script-src 'self'` (plus
	// SvelteKit's per-request nonce) locks the script surface; the hydration test in
	// demo/playwright/page.svelte.e2e.ts proves the nonce lets the app's own scripts still run.
	expect(headers['content-security-policy']).toContain("script-src 'self'")
})
