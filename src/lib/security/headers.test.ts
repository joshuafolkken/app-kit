import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { security_headers } from './headers.js'

const ENCODING = 'utf8'
const HEADERS_FILE = '_headers'
const HEADERS_TEMPLATE = 'templates/_headers'

// A `Name: value` line inside the `/*` block, ignoring comments and the rule selector itself.
// Literal spaces rather than `\s` classes: the file's indentation is exactly two spaces, and the
// looser form backtracks super-linearly.
const HEADER_LINE = /^ {2}([\w-]+): (.+)$/u

function parse_headers(file: string): Array<[string, string]> {
	const parsed: Array<[string, string]> = []

	for (const line of readFileSync(file, ENCODING).split('\n')) {
		const match = HEADER_LINE.exec(line)

		if (match?.[1] !== undefined && match[2] !== undefined) parsed.push([match[1], match[2]])
	}

	return parsed
}

function to_expected(): Array<[string, string]> {
	return security_headers.SECURITY_HEADERS.map(([name, value]) => [name, value])
}

describe('security header application', () => {
	it('sets every baseline header on the response', () => {
		const response = new Response('body')

		security_headers.apply_security_headers(response)

		for (const [name, value] of security_headers.SECURITY_HEADERS) {
			expect(response.headers.get(name)).toBe(value)
		}
	})

	it('preserves the rendered body and pre-existing headers', () => {
		// The hook decorates SvelteKit's resolved response — replacing it would drop the page.
		const response = new Response('body', { headers: { 'content-type': 'text/html' } })

		security_headers.apply_security_headers(response)

		expect(response.headers.get('content-type')).toBe('text/html')
	})

	it('overwrites a weaker value rather than appending a second header', () => {
		const response = new Response('body', { headers: { 'X-Frame-Options': 'SAMEORIGIN' } })

		security_headers.apply_security_headers(response)

		expect(response.headers.get('X-Frame-Options')).toBe('DENY')
	})
})

describe('_headers stays in sync with the runtime baseline', () => {
	// Cloudflare parses _headers as static text and cannot import this module, so the two
	// representations are necessarily separate. This is the guard that keeps them equal: static
	// assets are covered by the file, SSR responses by the hook, and a header added to one but
	// not the other would silently protect only half the surface.
	it('declares the same headers as the SSR hook', () => {
		expect(parse_headers(HEADERS_FILE)).toEqual(to_expected())
	})

	it('ships a template identical to the baseline consumers are told they get', () => {
		expect(parse_headers(HEADERS_TEMPLATE)).toEqual(to_expected())
	})
})
