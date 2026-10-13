import { security_headers } from '$lib/security/index.js'

// Cloudflare's `_headers` covers static assets only, so SSR responses get the same baseline here.
// Consumers get the same hook via `@joshuafolkken/app-kit/security`.
const { handle } = security_headers

export { handle }
