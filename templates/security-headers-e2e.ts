import { security_headers_e2e } from '@joshuafolkken/app-kit/security/e2e'
import { expect, test } from '@playwright/test'

// Seeded once by `josh-app sync`, then yours to extend. This is the Docker-free per-PR safety net
// that lets the full ZAP baseline scan (`.github/workflows/dast.yml`) run nightly instead of on
// every PR: the header findings that scan reports are asserted here in seconds, with no ~2.2 GB
// image pull. Deleting this file removes that net and leaves a header regression live until the
// next scheduled run.
//
// The assertions themselves live in app-kit and derive from its SECURITY_HEADERS baseline, so a
// header added upstream starts being checked here on the next update — nothing to copy forward.
// Add your INSTANCE-specific cases alongside them: the third-party origins your policy allowlists,
// a route carrying an embed, or proof that a site-specific inline bootstrap actually executed.

// `_headers` is a Cloudflare directive file applied by the Worker runtime — `pnpm run preview`
// and production. The vite dev server does not process it, and Playwright runs against dev
// locally (see playwright.config.ts), so this spec only carries meaning against the preview
// server, which is what CI runs and what `josh-app dast` scans. Skipping is honest here:
// asserting Worker behavior against a dev server would only produce a false failure.
const PREVIEW_PORT = '4173'

const DEV_SERVER_REASON = 'security headers come from the Worker runtime, not the vite dev server'

test('serves the baseline headers and a nonce-based CSP', async ({ page, baseURL: base_url }) => {
	// Not a disabled test: CI runs the preview server, where this executes and must pass.
	test.skip(!base_url?.includes(PREVIEW_PORT), DEV_SERVER_REASON)

	const response = await page.goto('/')

	// Each baseline header pins a ZAP finding closed by `_headers` (10020 / 10021 / 10063); the CSP
	// check pins 10038, which `kit.csp` in `svelte.config.js` closes instead. Both report a list of
	// departures rather than throwing, so a failure names every problem at once.
	expect(security_headers_e2e.baseline_problems(response)).toStrictEqual([])
	expect(security_headers_e2e.csp_problems(response)).toStrictEqual([])
})

test('renders with no Content-Security-Policy violation', async ({ page, baseURL: base_url }) => {
	// Same conditional skip as above: only the Worker runtime applies these, never the dev server.
	test.skip(!base_url?.includes(PREVIEW_PORT), DEV_SERVER_REASON)

	// Installed before navigating so the listener is in place for the very first script.
	const violations = await security_headers_e2e.watch_violations(page)

	await page.goto('/', { waitUntil: 'load' })
	await security_headers_e2e.settle(page)

	// A header can be perfectly shaped and still break the app; this is the half that proves the
	// policy admits what the page legitimately needs, not just that it blocks things.
	expect(violations).toStrictEqual([])
})
