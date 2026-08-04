import adapter from '@sveltejs/adapter-cloudflare'

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		runes: true,
	},
	vitePlugin: {
		// Our `runes: true` above is global and would also force third-party
		// components under node_modules into runes mode. Some still ship legacy
		// syntax (e.g. `export let`), which is illegal in runes mode and breaks
		// compilation. Let Svelte auto-detect the mode for dependencies instead,
		// so each compiles in its own intended mode while our own code stays runes.
		dynamicCompileOptions({ filename, compileOptions }) {
			if (filename.includes('node_modules') && compileOptions.runes) {
				return { runes: undefined }
			}
		},
	},
	kit: {
		adapter: adapter(),

		// Content-Security-Policy (closes the ZAP DAST finding "CSP Header Not Set [10038]").
		// SvelteKit emits the CSP as a real response header on SSR pages (and a <meta> tag on
		// prerendered ones), augmenting `script-src` with a per-request nonce for its own inline
		// hydration scripts — that is why `mode: 'auto'` (nonce for dynamic, hash for prerendered).
		//
		// The real XSS defense is `script-src 'self'` + the nonce: no inline or third-party script
		// runs. `default-src 'self'` gives every unlisted directive a same-origin fallback (without
		// it, ZAP flags "CSP: Failure to Define Directive with No Fallback [10055]").
		//
		// `style-src` includes `'unsafe-inline'` on purpose. SvelteKit's `app.html` ships a
		// `<div style="display: contents">` body wrapper, and Svelte transitions inject inline
		// `<style>` elements at runtime — a `style-src` without `'unsafe-inline'` would block those
		// and break any consumer that uses a transition (the SvelteKit docs call this out). Inline
		// STYLE cannot execute code, so this is a low-risk relaxation of the STYLE surface only; the
		// SCRIPT surface stays locked. ZAP notes the style `'unsafe-inline'`; it is triaged in
		// zap-baseline.conf with this reasoning. `img-src` allows `data:` for inline/SVG assets.
		// `frame-ancestors` and `form-action` do NOT fall back to `default-src`, so they must be
		// listed explicitly or ZAP's 10055 "no fallback" fires. `frame-ancestors 'none'` mirrors the
		// `X-Frame-Options: DENY` in `_headers`; `form-action 'self'` keeps form posts same-origin.
		csp: {
			mode: 'auto',
			directives: {
				'default-src': ['self'],
				'script-src': ['self'],
				'style-src': ['self', 'unsafe-inline'],
				'img-src': ['self', 'data:'],
				'object-src': ['none'],
				'base-uri': ['self'],
				'frame-ancestors': ['none'],
				'form-action': ['self'],
			},
		},
	},
}

export default config
