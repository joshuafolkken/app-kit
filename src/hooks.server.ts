import type { Handle } from '@sveltejs/kit'
import { security_headers } from '$lib/security/index.js'

// Cloudflare's `_headers` covers static assets only, so SSR responses get the same baseline here.
// Consumers compose the equivalent via `@joshuafolkken/app-kit/security`.
const handle: Handle = async ({ event, resolve }) => {
	return security_headers.apply_security_headers(await resolve(event))
}

export { handle }
