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
//
// Does your server hook pass a second argument to `apply_security_headers`? Hoist that array into a
// module both files import and pass it here as well — `baseline_problems(response, SECURITY_EXTRA)`.
// One list then drives the header and the expectation, so a deliberately stronger `Permissions-Policy`
// (or a relaxed `X-Frame-Options`) passes instead of reading as a departure, and the headers you ADD
// are asserted too. Leave it off and the expectation stays the bare app-kit baseline.

// `_headers` is a Cloudflare directive file applied by the Worker runtime — `pnpm run preview` and
// production. The vite dev server does not process it, and Playwright runs against dev locally (see
// playwright.config.ts), so this spec only carries meaning against the preview server, which is what
// CI runs and what `josh-app dast` scans. Skipping there is honest: asserting Worker behavior against
// a dev server would only produce a false failure.
//
// The decision lives in app-kit and asks the running server what it is, so there is no port to keep
// in step here (app-kit#127) — move your preview port and these tests keep running. Anything short of
// a positively identified dev server runs the assertions, so this can never go quietly uncovered.
test.beforeEach(async ({ page, baseURL: base_url }) => {
	// Not disabled tests: on the preview server this skip does not fire and both must pass.
	test.skip(
		await security_headers_e2e.is_development_server(page.request, base_url),
		security_headers_e2e.DEV_SERVER_REASON,
	)
})

test('serves the baseline headers and a nonce-based CSP', async ({ page }) => {
	const response = await page.goto('/')

	// Each baseline header pins a ZAP finding closed by `_headers` (10020 / 10021 / 10063); the CSP
	// check pins 10038, which `kit.csp` in `svelte.config.js` closes instead. Both report a list of
	// departures rather than throwing, so a failure names every problem at once.
	expect(security_headers_e2e.baseline_problems(response)).toStrictEqual([])
	expect(security_headers_e2e.csp_problems(response)).toStrictEqual([])
})

test('renders with no Content-Security-Policy violation', async ({ page }) => {
	// Installed before navigating so the listener is in place for the very first script.
	const violations = await security_headers_e2e.watch_violations(page)

	await page.goto('/', { waitUntil: 'load' })
	await security_headers_e2e.settle(page)

	// A header can be perfectly shaped and still break the app; this is the half that proves the
	// policy admits what the page legitimately needs, not just that it blocks things.
	expect(violations).toStrictEqual([])
})
