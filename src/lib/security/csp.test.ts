import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { security_csp } from './csp.js'
import { security_csp as published_csp } from './index.js'

const SVELTE_CONFIG = 'svelte.config.js'
const UNSAFE_INLINE = 'unsafe-inline'
// The two directives that never fall back to `default-src`: leaving either out re-opens ZAP 10055.
const NO_FALLBACK_DIRECTIVES = ['frame-ancestors', 'form-action'] as const

describe('security_csp.POLICY', () => {
	it('is the policy this repository itself runs', () => {
		expect(readFileSync(SVELTE_CONFIG, 'utf8')).toContain('csp: security_csp.POLICY,')
	})

	it('is published on the security entry a project config imports', () => {
		expect(published_csp.POLICY).toBe(security_csp.POLICY)
	})

	it('locks the script surface and relaxes only the style one', () => {
		const { directives } = security_csp.POLICY

		expect(security_csp.POLICY.mode).toBe('auto')
		expect(directives['script-src']).toEqual(['self'])
		expect(directives['style-src']).toContain(UNSAFE_INLINE)
	})

	it.each(NO_FALLBACK_DIRECTIVES)('lists %s explicitly', (directive) => {
		expect(security_csp.POLICY.directives[directive]).not.toHaveLength(0)
	})
})
