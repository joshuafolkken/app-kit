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
const SECURITY_HEADERS: ReadonlyArray<readonly [string, string]> = [
	// Stops MIME sniffing turning a user upload into executable script.
	['X-Content-Type-Options', 'nosniff'],
	// Framing is denied outright; a consumer that embeds itself should relax this deliberately.
	['X-Frame-Options', 'DENY'],
	// Send the origin cross-site, the full path same-origin — no leaking paths or query strings.
	['Referrer-Policy', 'strict-origin-when-cross-origin'],
	// Deny the powerful devices by default; opt back in per feature when a project needs one.
	['Permissions-Policy', 'camera=(), microphone=(), geolocation=()'],
]

// Applied to an existing Response rather than returning a new one: SvelteKit's `resolve()` result
// carries the rendered body and its own headers, which must survive intact.
function apply_security_headers(response: Response): Response {
	for (const [name, value] of SECURITY_HEADERS) {
		response.headers.set(name, value)
	}

	return response
}

const security_headers = { SECURITY_HEADERS, apply_security_headers }

export { security_headers }
