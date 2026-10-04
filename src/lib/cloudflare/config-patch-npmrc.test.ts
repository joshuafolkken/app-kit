import { describe, expect, it } from 'vitest'
import { config_patch } from './config-patch.js'

const AUTH_LINE = '//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}'
const SCOPE_LINE = '@joshuafolkken:registry=https://npm.pkg.github.com'
const CONSUMER_LINE = 'minimum-release-age=1440'

// The .npmrc of an existing consumer still routed to GitHub Packages — the state app-kit's overlay
// appends the credential to.
const NPMRC_KIT_BASE = `${SCOPE_LINE}
engine-strict=true
${CONSUMER_LINE}
`

// The .npmrc kit's current `josh init` writes for a new consumer: no scope route, so public npm.
const NPMRC_PUBLIC_NPM = `engine-strict=true
${CONSUMER_LINE}
`
const PUBLIC_SCOPE_LINE = '@joshuafolkken:registry=https://registry.npmjs.org/'

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

	it('appends after an indented scope route', () => {
		const indented = `  ${SCOPE_LINE}\n`

		expect(config_patch.patch_npmrc_content(indented)).toBe(`${indented}${AUTH_LINE}\n`)
	})

	it('appends after a scope route written with spaces around the equals sign', () => {
		const spaced = '@joshuafolkken:registry = https://npm.pkg.github.com\n'

		expect(config_patch.patch_npmrc_content(spaced)).toBe(`${spaced}${AUTH_LINE}\n`)
	})
})

describe('config patch — .npmrc on public npm (#258)', () => {
	it('leaves a kit-written .npmrc with no scope route untouched', () => {
		expect(config_patch.patch_npmrc_content(NPMRC_PUBLIC_NPM)).toBe(NPMRC_PUBLIC_NPM)
	})

	it('stays untouched across repeated passes', () => {
		const once = config_patch.patch_npmrc_content(NPMRC_PUBLIC_NPM)

		expect(config_patch.patch_npmrc_content(once)).toBe(NPMRC_PUBLIC_NPM)
	})

	it('does not treat a scope routed to public npm as GitHub Packages', () => {
		const routed_public = `${PUBLIC_SCOPE_LINE}\n`

		expect(config_patch.patch_npmrc_content(routed_public)).toBe(routed_public)
	})

	it('does not treat a commented-out GitHub Packages route as live', () => {
		const commented = `# ${SCOPE_LINE}\n`

		expect(config_patch.patch_npmrc_content(commented)).toBe(commented)
	})

	it('writes nothing into an empty file', () => {
		expect(config_patch.patch_npmrc_content('')).toBe('')
	})
})
