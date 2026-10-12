import { security_headers } from '@joshuafolkken/app-kit/security'

// Seeded once by `josh-app init`, then yours to extend. Cloudflare's `_headers` covers static
// assets only — every page the Worker renders bypasses it — so the same baseline is applied here.
// To add or override a header, write your own `handle` around `apply_security_headers`:
// docs/security-headers.md in app-kit.
const { handle } = security_headers

export { handle }
