// Baseline security headers, single-sourced here.
//
// Cloudflare's `_headers` file decorates STATIC ASSET responses only — anything the Worker
// renders (every SSR page) bypasses it entirely. Verified against `pnpm run preview`:
// /favicon.svg carried all four headers while / carried none. So the same baseline has to be
// applied at the SvelteKit layer too, or a DAST scan reports the findings on every page while
// the assets look clean.
//
// The root `_headers` file necessarily restates these — Cloudflare parses it as static text and
// cannot import a module. `headers.test.ts` parses that file and asserts it matches this array,
// so the two representations cannot drift apart silently.
// Deliberately excluded from the baseline:
//
// - Strict-Transport-Security: connection-scoped, so it would apply to both static and SSR — but
//   its `max-age`/`includeSubDomains`/`preload` is a site-specific HTTPS *commitment* (a browser
//   that sees it refuses HTTP for the whole `max-age`, which locks out preview domains and
//   partially-owned subdomains). A value baked into the baseline and pushed to every consumer via
//   `josh sync` is unsafe; a weak value is useless. Consumers add their own via `extra` below.
// - Content-Security-Policy: document-scoped, so it is meaningless on static-asset responses and
//   must never go in `_headers`. A working SvelteKit CSP needs nonce/hash wiring (`kit.csp` in
//   `svelte.config.js`), not a flat header; a consumer that still wants a header-based CSP on SSR
//   attaches it via `extra` — never here and never in the distributed `_headers`.
const SECURITY_HEADERS: ReadonlyArray<readonly [string, string]> = [
	// Stops MIME sniffing turning a user upload into executable script.
	['X-Content-Type-Options', 'nosniff'],
	// Framing is denied outright (pair with CSP `frame-ancestors 'none'`). A consumer that embeds
	// itself relaxes to `SAMEORIGIN` (pair with `frame-ancestors 'self'`) via `extra`, deliberately.
	['X-Frame-Options', 'DENY'],
	// Send the origin cross-site, the full path same-origin — no leaking paths or query strings.
	['Referrer-Policy', 'strict-origin-when-cross-origin'],
	// Deny the powerful devices by default; opt back in per feature when a project needs one.
	['Permissions-Policy', 'camera=(), microphone=(), geolocation=()'],
]

// Applied to an existing Response rather than returning a new one: SvelteKit's `resolve()` result
// carries the rendered body and its own headers, which must survive intact.
//
// `extra` is the composition point that lets an SSR consumer layer `baseline + app-specific`
// without re-implementing (and drifting from) the baseline. Each entry is a plain `headers.set`
// applied *after* the baseline, in order, so the last write wins — one list therefore covers both
// EXTENDING (a header the baseline omits, e.g. Strict-Transport-Security or a site-specific
// Content-Security-Policy) and OVERRIDING (a stronger/relaxed baseline value, e.g. widening
// Permissions-Policy or relaxing X-Frame-Options to SAMEORIGIN).
function apply_security_headers(
	response: Response,
	extra: ReadonlyArray<readonly [string, string]> = [],
): Response {
	for (const [name, value] of [...SECURITY_HEADERS, ...extra]) {
		response.headers.set(name, value)
	}

	return response
}

const security_headers = { SECURITY_HEADERS, apply_security_headers }

export { security_headers }
