import { describe, expect, it } from 'vitest'
import { config_patch } from './config-patch.js'

const AUTH_LINE = '//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}'
const SCOPE_LINE = '@joshuafolkken:registry=https://npm.pkg.github.com'
const CONSUMER_LINE = 'minimum-release-age=1440'

// The .npmrc kit's `josh init` writes — the state app-kit's overlay appends the credential to.
const NPMRC_KIT_BASE = `${SCOPE_LINE}
engine-strict=true
${CONSUMER_LINE}
`

// A consumer who authenticates with a literal token instead of the env-var form. The key is
// already theirs, so the overlay must not append a second line writing the same key. The stand-in
// value is deliberately unlike a real credential so no secret scanner has to reason about it.
const NPMRC_LITERAL_TOKEN = `${SCOPE_LINE}
//npm.pkg.github.com/:_authToken=consumer-owned-literal-value
`

// The on-disk wiring through patch_configs / apply_overlay is covered by sync.test.ts; these cases
// pin the pure content transform.
describe('config patch — .npmrc', () => {
	it('appends the credential line to a kit-written .npmrc, preserving every existing line', () => {
		const patched = config_patch.patch_npmrc_content(NPMRC_KIT_BASE)

		expect(patched).toBe(`${NPMRC_KIT_BASE}${AUTH_LINE}\n`)
		expect(patched).toContain(SCOPE_LINE)
		expect(patched).toContain(CONSUMER_LINE)
	})

	it('is idempotent — a second pass on the patched file is a no-op', () => {
		const once = config_patch.patch_npmrc_content(NPMRC_KIT_BASE)

		expect(config_patch.patch_npmrc_content(once)).toBe(once)
	})

	it('leaves a consumer-owned token for the same key untouched', () => {
		expect(config_patch.patch_npmrc_content(NPMRC_LITERAL_TOKEN)).toBe(NPMRC_LITERAL_TOKEN)
	})

	it('recognizes the setting through leading whitespace', () => {
		const indented = `${SCOPE_LINE}\n  ${AUTH_LINE}\n`

		expect(config_patch.patch_npmrc_content(indented)).toBe(indented)
	})

	it('treats a commented-out entry as the consumer opt-out and does not re-add it', () => {
		const opted_out = `${SCOPE_LINE}\n# ${AUTH_LINE}\n`

		expect(config_patch.patch_npmrc_content(opted_out)).toBe(opted_out)
	})

	it('separates the appended line when the file has no trailing newline', () => {
		expect(config_patch.patch_npmrc_content(SCOPE_LINE)).toBe(`${SCOPE_LINE}\n${AUTH_LINE}\n`)
	})

	it('writes the line alone into an empty file without a leading blank line', () => {
		expect(config_patch.patch_npmrc_content('')).toBe(`${AUTH_LINE}\n`)
	})
})
