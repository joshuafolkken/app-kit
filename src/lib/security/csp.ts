// The Content-Security-Policy app-kit runs on itself and hands to a project, single-sourced here:
// `svelte.config.js` in this repository reads it, and `josh-app init` wires a fresh project's config
// to it (app-kit#291). It closes the ZAP DAST finding "CSP Header Not Set [10038]".
//
// SvelteKit emits the CSP as a real response header on SSR pages (and a <meta> tag on prerendered
// ones), augmenting `script-src` with a per-request nonce for its own inline hydration scripts —
// that is why `mode: 'auto'` (nonce for dynamic, hash for prerendered).
//
// The real XSS defense is `script-src 'self'` + the nonce: no inline or third-party script runs.
// `default-src 'self'` gives every unlisted directive a same-origin fallback (without it, ZAP flags
// "CSP: Failure to Define Directive with No Fallback [10055]").
//
// `style-src` includes `'unsafe-inline'` on purpose. SvelteKit's `app.html` ships a
// `<div style="display: contents">` body wrapper, and Svelte transitions inject inline `<style>`
// elements at runtime — a `style-src` without `'unsafe-inline'` would block those and break any
// consumer that uses a transition (the SvelteKit docs call this out). Inline STYLE cannot execute
// code, so this is a low-risk relaxation of the STYLE surface only; the SCRIPT surface stays locked.
// ZAP notes the style `'unsafe-inline'`; it is triaged in zap-baseline.conf with this reasoning.
// `img-src` allows `data:` for inline/SVG assets. `frame-ancestors` and `form-action` do NOT fall
// back to `default-src`, so they must be listed explicitly or ZAP's 10055 "no fallback" fires.
// `frame-ancestors 'none'` mirrors the `X-Frame-Options: DENY` in `_headers`; `form-action 'self'`
// keeps form posts same-origin.

// Keeps each source a literal in a mutable array. SvelteKit types every directive as its own union
// of sources, so a `string[]` is refused and an `as const` tuple is read-only; this shape is
// assignable to the option under any SvelteKit version without importing its types.
function sources<const Source extends string>(...values: Array<Source>): Array<Source> {
	return values
}

const MODE = 'auto' as const

const POLICY = {
	mode: MODE,
	directives: {
		'default-src': sources('self'),
		'script-src': sources('self'),
		'style-src': sources('self', 'unsafe-inline'),
		'img-src': sources('self', 'data:'),
		'object-src': sources('none'),
		'base-uri': sources('self'),
		'frame-ancestors': sources('none'),
		'form-action': sources('self'),
	},
}

const security_csp = { POLICY }

export { security_csp }
