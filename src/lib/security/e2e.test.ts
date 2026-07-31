import { describe, expect, it, vi } from 'vitest'
import { security_headers_e2e } from './e2e.js'
import { security_headers } from './headers.js'

const CSP_HEADER = 'content-security-policy'
const SCRIPT_SRC = 'script-src'
const SCRIPT_SRC_SELF = `${SCRIPT_SRC} 'self'`
const STYLE_SRC_OPEN = "style-src 'self' 'unsafe-inline'"
const UNSAFE_INLINE = "'unsafe-inline'"
const NONCE = "'nonce-abc123'"

// A nonce-based, transition-safe policy — the shape `kit.csp` in svelte.config.js emits.
const GOOD_CSP = [
	"default-src 'self'",
	`${SCRIPT_SRC_SELF} ${NONCE}`,
	STYLE_SRC_OPEN,
	"object-src 'none'",
].join('; ')

interface FakeResponse {
	headers: () => Record<string, string>
}

function baseline_record(): Record<string, string> {
	return Object.fromEntries(
		security_headers.SECURITY_HEADERS.map(([name, value]) => [name.toLowerCase(), value]),
	)
}

// Stands in for a Playwright `Response`. A plain object satisfies the port, so no cast is needed.
function response_of(headers: Record<string, string>): FakeResponse {
	return { headers: () => headers }
}

function baseline_problems_of(headers: Record<string, string>): Array<string> {
	return security_headers_e2e.baseline_problems(response_of(headers))
}

function csp_problems_of(csp: string): Array<string> {
	return security_headers_e2e.csp_problems(response_of({ ...baseline_record(), [CSP_HEADER]: csp }))
}

describe('baseline_problems — derived from SECURITY_HEADERS, never restated', () => {
	it('reports nothing when every baseline header is served with its exact value', () => {
		expect(baseline_problems_of(baseline_record())).toStrictEqual([])
	})

	// The whole reason the checks live in app-kit: a header added to the runtime baseline has to
	// widen every consumer's E2E automatically, or the seeded file silently half-covers the surface.
	it.each(security_headers.SECURITY_HEADERS.map(([name]) => name))(
		'reports %s when it is absent',
		(missing) => {
			const headers = baseline_record()

			// eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- the key is a header name
			delete headers[missing.toLowerCase()]

			const problems = baseline_problems_of(headers)

			expect(problems).toHaveLength(1)
			expect(problems[0]).toContain(missing)
			expect(problems[0]).toContain('(absent)')
		},
	)

	it('reports a header served with a weaker value than the baseline declares', () => {
		const headers = { ...baseline_record(), 'x-frame-options': 'SAMEORIGIN' }

		expect(baseline_problems_of(headers)).toStrictEqual([
			'X-Frame-Options: expected "DENY", served "SAMEORIGIN"',
		])
	})

	it('reports a navigation that produced no response at all', () => {
		// eslint-disable-next-line unicorn/no-null -- page.goto resolves to Response | null
		expect(security_headers_e2e.baseline_problems(null)).toStrictEqual([
			'the navigation produced no response to assert on',
		])
	})
})

describe('csp_problems — the script surface stays locked', () => {
	it('reports nothing for the policy kit.csp emits', () => {
		expect(csp_problems_of(GOOD_CSP)).toStrictEqual([])
	})

	it('reports an absent CSP header', () => {
		const without_csp = response_of(baseline_record())

		expect(security_headers_e2e.csp_problems(without_csp)).toStrictEqual([
			`no ${CSP_HEADER} header on the response`,
		])
	})

	it('reports a script-src carrying no nonce', () => {
		expect(csp_problems_of(GOOD_CSP.split(` ${NONCE}`).join(''))).toStrictEqual([
			`${SCRIPT_SRC} is not nonce-based: 'self'`,
		])
	})

	// The regression joshuafolkken-com#790 migrated away from: a policy that still allows inline
	// script protects nothing, even with a nonce sitting right beside it.
	it("reports a script-src allowing 'unsafe-inline' even when a nonce is present", () => {
		const csp = GOOD_CSP.split(SCRIPT_SRC_SELF).join(`${SCRIPT_SRC_SELF} ${UNSAFE_INLINE}`)

		expect(csp_problems_of(csp)).toStrictEqual([`${SCRIPT_SRC} allows ${UNSAFE_INLINE}`])
	})

	it('reports a policy that never declares script-src', () => {
		expect(csp_problems_of(`default-src 'self'; ${STYLE_SRC_OPEN}`)).toStrictEqual([
			`${SCRIPT_SRC} is not declared`,
		])
	})

	// `script-src-elem` shares script-src's opening characters; a prefix match would read its
	// sources as script-src's and pass a policy that never declared script-src at all.
	it('does not mistake a longer directive name for the one it looks up', () => {
		const csp = `default-src 'self'; script-src-elem 'self' ${NONCE}; ${STYLE_SRC_OPEN}`

		expect(csp_problems_of(csp)).toStrictEqual([`${SCRIPT_SRC} is not declared`])
	})
})

describe('csp_problems — the style surface stays deliberately open', () => {
	// Inverted on purpose relative to script-src: dropping 'unsafe-inline' here white-screens any
	// page using a Svelte transition, so the check guards the relaxation rather than the lock.
	it("reports a style-src that dropped 'unsafe-inline'", () => {
		const problems = csp_problems_of(GOOD_CSP.split(STYLE_SRC_OPEN).join("style-src 'self'"))

		expect(problems).toHaveLength(1)
		expect(problems[0]).toContain('style-src must keep')
	})

	it('reports a policy that never declares style-src', () => {
		expect(csp_problems_of(`default-src 'self'; ${SCRIPT_SRC_SELF} ${NONCE}`)).toStrictEqual([
			'style-src is not declared',
		])
	})

	// A single run has to name everything wrong with the policy: reporting one problem per attempt
	// turns one broken CSP into as many red CI runs as it has departures.
	it('reports both surfaces at once rather than stopping at the first', () => {
		const csp = `default-src 'self'; ${SCRIPT_SRC_SELF}; style-src 'self'`

		expect(csp_problems_of(csp)).toHaveLength(2)
	})
})

interface ViolationEvent {
	violatedDirective: string
	blockedURI: string
	sourceFile: string
}

type ViolationListener = (event: ViolationEvent) => void

const NO_LISTENER: ViolationListener = () => undefined

// Drives the watcher the way Playwright does: capture the exposed bridge and the init script, then
// run that script against a stubbed document so the listener it registers can actually be fired.
function fake_page(): {
	page: Parameters<typeof security_headers_e2e.watch_violations>[0]
	fire: ViolationListener
} {
	const captured = { listener: NO_LISTENER }

	const stub_document = (): void => {
		vi.stubGlobal('document', {
			addEventListener: (_type: string, handler: ViolationListener): void => {
				captured.listener = handler
			},
		})
	}

	const page = {
		exposeFunction: async (name: string, report: (detail: string) => void): Promise<void> => {
			vi.stubGlobal(name, report)
		},
		addInitScript: async (script: () => void): Promise<void> => {
			stub_document()
			script()
		},
	}

	return {
		page,
		fire: (event) => {
			captured.listener(event)
		},
	}
}

describe('watch_violations — the half that proves the policy admits what the page needs', () => {
	it('starts empty so a clean render reports an empty array', async () => {
		const { page } = fake_page()

		expect(await security_headers_e2e.watch_violations(page)).toStrictEqual([])
	})

	it('records the directive, blocked URI, and source of a reported violation', async () => {
		const { page, fire } = fake_page()
		const violations = await security_headers_e2e.watch_violations(page)

		fire({ violatedDirective: SCRIPT_SRC, blockedURI: 'https://cdn.example', sourceFile: 'x.js' })

		expect(violations).toStrictEqual([`${SCRIPT_SRC}: https://cdn.example (x.js)`])
	})

	it('labels a violation with no source file as inline', async () => {
		const { page, fire } = fake_page()
		const violations = await security_headers_e2e.watch_violations(page)

		fire({ violatedDirective: SCRIPT_SRC, blockedURI: 'inline', sourceFile: '' })

		expect(violations[0]).toContain('(inline)')
	})
})

describe('settle — a bounded window, because a polling page never reaches idle', () => {
	it('waits for network idle within the default window', async () => {
		const wait = vi.fn(async (): Promise<void> => undefined)

		await security_headers_e2e.settle({ waitForLoadState: wait })

		expect(wait).toHaveBeenCalledWith('networkidle', {
			timeout: security_headers_e2e.SETTLE_TIMEOUT_MS,
		})
	})

	// The point of the helper: a page still busy after the window must let the caller report on what
	// has arrived, not fail the run with a timeout that says nothing about the policy.
	it('resolves instead of throwing when the page is still busy', async () => {
		const wait = vi.fn(async (): Promise<void> => {
			throw new Error('Timeout exceeded')
		})

		await expect(security_headers_e2e.settle({ waitForLoadState: wait })).resolves.toBeUndefined()
	})
})
