# Security headers and Content-Security-Policy

app-kit ships a security-header baseline, a Content-Security-Policy setup and a per-PR E2E spec that checks both. The full OWASP ZAP scan that backs them up runs nightly: [dast.md](./dast.md).

## The `_headers` baseline

`josh-app sync` seeds a root `_headers` file with a baseline (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`), which closes ZAP findings 10020 / 10021 / 10063 and the COOP sub-alert of 90004.

`_headers` is seed-only — sync never rewrites the copy you own. A project seeded before `Cross-Origin-Opener-Policy` joined the baseline gets it on SSR pages automatically (the hook below applies the updated package baseline) but must add the `Cross-Origin-Opener-Policy: same-origin` line to its own `_headers` for static assets, or they stay covered by only half the surface.

## Apply the baseline to SSR pages

**`_headers` covers static assets only.** Cloudflare applies it to asset responses; anything the Worker renders — every SSR page — bypasses it. Apply the same baseline in your server hook:

```ts
// src/hooks.server.ts
import { security_headers } from '@joshuafolkken/app-kit/security'
import type { Handle } from '@sveltejs/kit'

export const handle: Handle = async ({ event, resolve }) =>
	security_headers.apply_security_headers(await resolve(event))
```

### Extend and override the baseline

A real app usually wants _more_ than the baseline on its SSR responses (`Strict-Transport-Security`, a site-specific `Content-Security-Policy`) and sometimes a relaxed baseline value (`X-Frame-Options: SAMEORIGIN` when it embeds itself). Pass those as a second argument instead of re-implementing the baseline and drifting from it — each entry is applied _after_ the baseline, so a new name **extends** and a repeated name **overrides**:

```ts
const HSTS = 'max-age=31536000; includeSubDomains'

export const handle: Handle = async ({ event, resolve }) =>
	security_headers.apply_security_headers(await resolve(event), [
		['Strict-Transport-Security', HSTS], // extend: baseline omits it
		['X-Frame-Options', 'SAMEORIGIN'], // override: relax the baseline DENY (pair with CSP frame-ancestors 'self')
	])
```

Pass that same array to `baseline_problems` in the seeded E2E spec ([below](#if-your-hook-composes-onto-the-baseline)) — otherwise the spec expects the bare baseline and reports your override as a departure.

### Popup flows and `Cross-Origin-Opener-Policy`

`Cross-Origin-Opener-Policy: same-origin` **is** in the baseline, and it is **breaking for popup flows**: it severs `window.opener`, so a popup-based integration (popup OAuth such as a better-auth social login opened in a popup, payment popups) loses its opener and the flow's completion callback never reaches the opening page. Redirect-based flows — better-auth's default — are unaffected. A consumer with a popup flow relaxes the header instead of dropping it, exactly like the `X-Frame-Options` relaxation above:

```ts
['Cross-Origin-Opener-Policy', 'same-origin-allow-popups'], // override: keep opener for popups THIS site opens
```

and mirrors the same value in its `_headers` file so static assets stay in step.

### What the baseline leaves out on purpose

- **`Strict-Transport-Security`**: its `max-age`/`preload` is a site-specific HTTPS commitment (a browser that sees it refuses HTTP for the whole `max-age`), so each app opts in with its own value via the second argument rather than inheriting one through sync.
- **Content-Security-Policy**: it is document-scoped (meaningless on static assets) and a working SvelteKit CSP needs nonce/hash wiring, not a static header line. It is configured through `kit.csp` in `svelte.config.js` instead ([below](#content-security-policy)); a consumer that still wants a header-based CSP on SSR passes it through the same second argument.

## Content-Security-Policy

`svelte.config.js` sets `kit.csp` so SvelteKit emits a real `Content-Security-Policy` header on SSR pages (and a `<meta>` tag on prerendered ones), closing the ZAP finding **CSP Header Not Set [10038]**. `mode: 'auto'` augments `script-src` with a per-request **nonce** on dynamic pages and a **hash** on prerendered ones, so the app's own hydration script runs while inline injection is blocked — the E2E in `demo/playwright/page.svelte.e2e.ts` proves hydration still works under it.

The directives are chosen so the **script surface stays locked** (`script-src 'self'` + nonce, no `unsafe-inline`) — that is the real XSS defense. Two deliberate relaxations:

- `style-src` keeps `'unsafe-inline'`. SvelteKit's `app.html` ships an inline `style="display: contents"` body wrapper and Svelte transitions inject inline `<style>` at runtime; a stricter `style-src` white-screens any consumer that uses a transition (the SvelteKit docs call this out). Inline _style_ cannot execute JS, so this relaxes the style surface only. ZAP notes it as the sole `10055` sub-alert; it is triaged in `zap-baseline.conf`, and a unit test in `config-presets.test.ts` guards that `script-src` never gains `unsafe-inline` behind that IGNORE.
- `frame-ancestors 'none'` and `form-action 'self'` are listed explicitly because they do **not** fall back to `default-src` — omitting them re-opens `10055`'s "no fallback" sub-alert.

**`svelte.config.js` is yours** — `josh-app sync` does not distribute it. Copy the `kit.csp` block from this repo's `svelte.config.js` as a starting point and adjust the directives for your app (e.g. add `connect-src` / `img-src` origins for third-party APIs or CDNs you call).

## The per-PR E2E spec

`josh-app sync` seeds `src/routes/security-headers.e2e.ts` once, then it is yours. It runs in the normal E2E job — no Docker, a few seconds — and asserts the stack-universal half of the contract:

- every header of the baseline is served on a rendered page (derived from `SECURITY_HEADERS`, so a header added upstream starts being checked without you touching the file)
- the `Content-Security-Policy` header is present, `script-src` carries a per-request nonce and no `'unsafe-inline'`, and `style-src` keeps `'unsafe-inline'` for Svelte transition styles
- the page renders with **zero** `securitypolicyviolation` events — the half that proves the policy admits what the app legitimately needs, not just that it blocks things

The checks themselves live in app-kit and are imported, not copied. Each **reports** the departures it finds rather than asserting internally, so the `expect` stays in your spec where the linter — and the next reader — can see it:

```ts
import { security_headers_e2e } from '@joshuafolkken/app-kit/security/e2e'

const response = await page.goto('/')

expect(security_headers_e2e.baseline_problems(response)).toStrictEqual([])
expect(security_headers_e2e.csp_problems(response)).toStrictEqual([])
```

A failure prints every departure at once (`script-src is not nonce-based: 'self' 'unsafe-inline'`), not just the first one.

Extend the seeded file with what only your project knows — the third-party origins your policy allowlists, a route carrying an embed, proof that a site-specific inline bootstrap executed. A re-sync never overwrites it.

### If your hook composes onto the baseline

`baseline_problems(response)` with one argument expects the bare app-kit baseline. So a hook that _overrides_ a baseline value through `apply_security_headers`'s second argument fails the spec even when the served value is stronger than the baseline, e.g. a `Permissions-Policy` that also denies `payment` (app-kit#154). Hoist the array into a module both files import and pass it to both:

```ts
// src/lib/server/security-headers.ts
export const SECURITY_EXTRA = [
	['Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()'], // override
	['Strict-Transport-Security', 'max-age=31536000; includeSubDomains'], // extend
] as const

// src/hooks.server.ts
security_headers.apply_security_headers(await resolve(event), SECURITY_EXTRA)

// src/routes/security-headers.e2e.ts
expect(security_headers_e2e.baseline_problems(response, SECURITY_EXTRA)).toStrictEqual([])
```

One list drives the header and the expectation, so there is no second value to keep in step. It also puts the _extending_ entries under the assertion — with no array, a header outside the baseline (`Strict-Transport-Security` above) is not checked at all, so a hook that quietly stopped applying it would go unnoticed. Extending-only projects can therefore adopt this for the extra coverage; only overriding ones have to.

### When it runs

`_headers` is applied by the Worker runtime (`pnpm run preview` and production), never by the vite dev server, so the spec skips on a dev-server run rather than reporting a false failure. It decides which one it is by asking the running server — the vite HMR client path answers with JavaScript on dev and 404s on a built app — so there is **no port for you to keep in step**, and moving your preview port cannot quietly disable the net. Anything inconclusive (no base URL, an unreachable origin, an answer that is not the client script) runs the assertions: a security check must never be skipped silently.

Already seeded before app-kit 0.57.0? Your copy still compares `baseURL` against a hardcoded `'4173'` and goes uncovered if that port ever changes. Replace the two `test.skip(...)` lines with one hook to pick up the port-free decision:

```ts
test.beforeEach(async ({ page, baseURL: base_url }) => {
	test.skip(
		await security_headers_e2e.is_development_server(page.request, base_url),
		security_headers_e2e.DEV_SERVER_REASON,
	)
})
```
