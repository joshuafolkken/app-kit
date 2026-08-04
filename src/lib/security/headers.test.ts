import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { security_headers } from './headers.js'

const ENCODING = 'utf8'
const HEADERS_FILE = '_headers'
const HEADERS_TEMPLATE = 'templates/_headers'
// The seed's full source, comments included — the prose is what the assertions below are about.
const TEMPLATE_SOURCE = readFileSync(HEADERS_TEMPLATE, ENCODING)

const X_FRAME_OPTIONS = 'X-Frame-Options'
const SAMEORIGIN = 'SAMEORIGIN'
const HSTS_HEADER = 'Strict-Transport-Security'
const CSP_HEADER = 'Content-Security-Policy'
const CSP_LOCKED = "default-src 'none'"
const CSP_SELF = "default-src 'self'"
const HSTS = 'max-age=31536000; includeSubDomains'

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
		const response = new Response('body', { headers: { [X_FRAME_OPTIONS]: SAMEORIGIN } })

		security_headers.apply_security_headers(response)

		expect(response.headers.get(X_FRAME_OPTIONS)).toBe('DENY')
	})
})

describe('composition — extending and overriding the baseline', () => {
	it('extends the baseline with a header it omits', () => {
		const response = new Response('body')

		security_headers.apply_security_headers(response, [[HSTS_HEADER, HSTS]])

		expect(response.headers.get(HSTS_HEADER)).toBe(HSTS)
		// The baseline is still applied alongside the extension.
		expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
	})

	it('overrides a baseline value when the consumer relaxes it', () => {
		const response = new Response('body')

		security_headers.apply_security_headers(response, [[X_FRAME_OPTIONS, SAMEORIGIN]])

		// `extra` applies after the baseline, so the consumer value wins over the baseline DENY.
		expect(response.headers.get(X_FRAME_OPTIONS)).toBe(SAMEORIGIN)
	})

	it('leaves baseline headers the consumer did not name untouched', () => {
		const response = new Response('body')

		security_headers.apply_security_headers(response, [[X_FRAME_OPTIONS, SAMEORIGIN]])

		expect(response.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin')
		expect(response.headers.get('Permissions-Policy')).toBe(
			'camera=(), microphone=(), geolocation=()',
		)
	})
})

describe('composition — ordering and the default empty extra', () => {
	it('applies extra entries in order — the last write wins for a repeated name', () => {
		const response = new Response('body')

		security_headers.apply_security_headers(response, [
			[CSP_HEADER, CSP_SELF],
			[CSP_HEADER, CSP_LOCKED],
		])

		expect(response.headers.get(CSP_HEADER)).toBe(CSP_LOCKED)
	})

	it('is identical to the baseline-only call when extra is omitted', () => {
		const with_default = new Response('body')
		const with_empty = new Response('body')

		security_headers.apply_security_headers(with_default)
		security_headers.apply_security_headers(with_empty, [])

		for (const [name] of security_headers.SECURITY_HEADERS) {
			expect(with_empty.headers.get(name)).toBe(with_default.headers.get(name))
		}
	})
})

// app-kit#154: the E2E assertions have to expect what the hook APPLIES, so both sides derive from
// this one call. Every case below is therefore a property `apply_security_headers` already had —
// asserted here because `baseline_problems` now depends on it holding.
describe('composed_headers — the single source both the hook and the E2E expect', () => {
	it('is the baseline itself when nothing is composed onto it', () => {
		expect(security_headers.composed_headers()).toStrictEqual(to_expected())
	})

	it('appends a header the baseline omits, after the baseline entries', () => {
		expect(security_headers.composed_headers([[HSTS_HEADER, HSTS]])).toStrictEqual([
			...to_expected(),
			[HSTS_HEADER, HSTS],
		])
	})

	// The heart of #154: an override must REPLACE the baseline entry, not sit beside it. Two entries
	// for one name would make the E2E expect both values and report the losing one as a departure.
	it('replaces a baseline entry in place when the same header is overridden', () => {
		const composed = security_headers.composed_headers([[X_FRAME_OPTIONS, SAMEORIGIN]])

		expect(composed).toHaveLength(security_headers.SECURITY_HEADERS.length)
		expect(composed).toContainEqual([X_FRAME_OPTIONS, SAMEORIGIN])
	})

	// `Headers` folds names case-insensitively, so a lowercase override wins on the response. The
	// expectation has to fold the same way or the E2E reports a departure the browser never sees.
	it('folds a differently-cased name onto the baseline entry it overrides', () => {
		const lowercased = X_FRAME_OPTIONS.toLowerCase()
		const composed = security_headers.composed_headers([[lowercased, SAMEORIGIN]])

		expect(composed).toHaveLength(security_headers.SECURITY_HEADERS.length)
		expect(composed).toContainEqual([lowercased, SAMEORIGIN])
	})

	it('keeps only the last write when one name is composed twice', () => {
		const composed = security_headers.composed_headers([
			[CSP_HEADER, CSP_SELF],
			[CSP_HEADER, CSP_LOCKED],
		])
		const csp = composed.filter(([name]) => name === CSP_HEADER)

		expect(csp).toStrictEqual([[CSP_HEADER, CSP_LOCKED]])
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

	// Two physical copies of one artifact: the seed consumers receive and the file app-kit itself
	// runs `josh-app dast` against. They have never diverged, and a divergence would mean app-kit
	// ships guidance it does not follow — including the comment prose, which is the whole payload of
	// a file whose rule block is four lines long.
	it('keeps the repo-root copy byte-identical to the seeded template', () => {
		expect(readFileSync(HEADERS_FILE, ENCODING)).toBe(TEMPLATE_SOURCE)
	})
})

// app-kit#121: the seeded comment used to call the CSP "tracked separately" — reading as work still
// outstanding — while zap-baseline.conf already omits rule 10038 on the stated grounds that kit.csp
// emits the header. A consumer who believes the seed hand-rolls a static policy instead, which is
// exactly what joshuafolkken-com did until joshuafolkken-com#790 moved it to kit.csp.
describe('the seeded _headers presents CSP as already configured in kit.csp (#121)', () => {
	it('no longer frames the CSP as an unresolved item', () => {
		expect(TEMPLATE_SOURCE).not.toContain('tracked separately')
	})

	it('names kit.csp and the per-request nonce SvelteKit already emits', () => {
		expect(TEMPLATE_SOURCE).toContain('kit.csp')
		expect(TEMPLATE_SOURCE).toContain('per-request nonce')
	})

	it('states that a CSP line here is harmful, not merely absent', () => {
		expect(TEMPLATE_SOURCE).toContain('never add a CSP line here')
	})

	// headers.ts and the README both grant this escape hatch. Omitting it here would leave the seed
	// contradicting them — a smaller version of the very drift #121 is closing.
	it('still names the `extra` escape hatch for a project that needs a header CSP on SSR', () => {
		expect(TEMPLATE_SOURCE).toContain('apply_security_headers')
		expect(TEMPLATE_SOURCE).toContain('`extra`')
	})
})
