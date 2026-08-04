import { describe, expect, it, vi } from 'vitest'
import { security_headers_e2e } from './e2e.js'
import { security_headers } from './headers.js'

const CSP_HEADER = 'content-security-policy'
const SCRIPT_SRC = 'script-src'
const SCRIPT_SRC_SELF = `${SCRIPT_SRC} 'self'`
const STYLE_SRC_OPEN = "style-src 'self' 'unsafe-inline'"
const UNSAFE_INLINE = "'unsafe-inline'"
const NONCE = "'nonce-abc123'"
// A baseline header a consumer hardens, and one the baseline omits entirely — the OVERRIDE and the
// EXTEND halves of `extra`, which app-kit#154 is about telling apart.
const PERMISSIONS_POLICY = 'Permissions-Policy'
const HARDENED_POLICY = 'camera=(), microphone=(), geolocation=(), payment=()'
const HSTS_HEADER = 'Strict-Transport-Security'
const HSTS = 'max-age=31536000; includeSubDomains'

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

function baseline_problems_of(
	headers: Record<string, string>,
	extra: ReadonlyArray<readonly [string, string]> = [],
): Array<string> {
	return security_headers_e2e.baseline_problems(response_of(headers), extra)
}

/** The baseline as served by a consumer whose Permissions-Policy denies `payment` on top of it. */
function hardened_record(): Record<string, string> {
	return { ...baseline_record(), [PERMISSIONS_POLICY.toLowerCase()]: HARDENED_POLICY }
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

// app-kit#154: `apply_security_headers` documents `extra` as the way to override a baseline value,
// while this check compared against the bare baseline — so a consumer that HARDENED a header failed
// the spec app-kit seeds. Passing the same array here is what makes the two agree.
describe('baseline_problems — an override the consumer declared is not a departure', () => {
	// The exact joshuafolkken-com#805 failure: the served value denies everything the baseline denies
	// plus `payment`, and was reported as a departure anyway.
	it('accepts a baseline header the consumer deliberately strengthened', () => {
		const extra = [[PERMISSIONS_POLICY, HARDENED_POLICY]] as const

		expect(baseline_problems_of(hardened_record(), extra)).toStrictEqual([])
	})

	// The other half of the same pair: without the array there is no declared override, so the
	// departure is still reported — the argument is what authorizes it, not a loosened comparison.
	it('still reports the same value when no override is declared', () => {
		expect(baseline_problems_of(hardened_record())).toStrictEqual([
			`${PERMISSIONS_POLICY}: expected "camera=(), microphone=(), geolocation=()", served "${HARDENED_POLICY}"`,
		])
	})

	it('accepts a lowercase override, which wins on the response just the same', () => {
		const extra = [[PERMISSIONS_POLICY.toLowerCase(), HARDENED_POLICY]] as const

		expect(baseline_problems_of(hardened_record(), extra)).toStrictEqual([])
	})

	// The seeded spec calls this with one argument, and every consumer that only ever used the
	// baseline keeps that call — it has to stay exactly as strict as it was.
	it('expects the untouched baseline when the call declares no composition', () => {
		const headers = { ...baseline_record(), 'x-frame-options': 'SAMEORIGIN' }

		expect(baseline_problems_of(headers, [])).toStrictEqual(baseline_problems_of(headers))
	})
})

describe('baseline_problems — a declared extension is asserted, not ignored', () => {
	// Extending was never broken — it was never CHECKED either, because a header outside the baseline
	// was not compared at all. Declaring it here puts it under the same assertion.
	it('reports an extending header the hook applies but the response is missing', () => {
		const extra = [[HSTS_HEADER, HSTS]] as const

		expect(baseline_problems_of(baseline_record(), extra)).toStrictEqual([
			`${HSTS_HEADER}: expected "${HSTS}", served "(absent)"`,
		])
	})

	it('reports nothing when the extending header is served as composed', () => {
		const headers = { ...baseline_record(), [HSTS_HEADER.toLowerCase()]: HSTS }

		expect(baseline_problems_of(headers, [[HSTS_HEADER, HSTS]])).toStrictEqual([])
	})

	// The invariant the whole design rests on, asserted end to end rather than inferred from the two
	// halves: a response the hook actually built from one array cannot depart from that same array.
	// Feed it real `Headers` too, so the lowercase names a browser serves are what gets compared.
	it('reports nothing for a response the hook itself composed from the same array', () => {
		const extra = [
			[PERMISSIONS_POLICY, HARDENED_POLICY],
			[HSTS_HEADER, HSTS],
		] as const
		const response = security_headers.apply_security_headers(new Response('body'), extra)

		expect(baseline_problems_of(Object.fromEntries(response.headers), extra)).toStrictEqual([])
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

const BASE_URL = 'http://localhost:4173'
const VITE_CLIENT_URL = `${BASE_URL}/@vite/client`
const CONTENT_TYPE = 'content-type'
const JAVASCRIPT = 'text/javascript'
const HTML = 'text/html'

type ProbeRequest = Parameters<typeof security_headers_e2e.is_development_server>[0]

interface FakeAnswer {
	ok: boolean
	type: string
}

/** Stands in for a Playwright `APIResponse`; a plain object satisfies the port, as above. */
interface FakeProbeResponse {
	ok: () => boolean
	headers: () => Record<string, string>
}

// Stands in for `page.request`: records the probed URL and answers with the given response.
function fake_request(answer: FakeAnswer): { request: ProbeRequest; probed: Array<string> } {
	const probed: Array<string> = []

	const get = async (url: string): Promise<FakeProbeResponse> => {
		probed.push(url)

		return { ok: () => answer.ok, headers: () => ({ [CONTENT_TYPE]: answer.type }) }
	}

	return { probed, request: { get } }
}

async function is_development_server_for(answer: FakeAnswer): Promise<boolean> {
	return await security_headers_e2e.is_development_server(fake_request(answer).request, BASE_URL)
}

// A 200 carrying no content-type at all — neither the client script nor a recognizable page.
async function get_untyped_response(): Promise<FakeProbeResponse> {
	return { ok: () => true, headers: () => ({}) }
}

async function get_refused(): Promise<FakeProbeResponse> {
	throw new Error('connect ECONNREFUSED')
}

// app-kit#127: the seeded spec used to decide this by comparing baseURL against a hardcoded '4173'.
// A consumer who moved their preview port got two silently skipped tests and a green run carrying no
// header coverage at all — hence both halves below, and especially the inconclusive one.
describe('is_development_server — asks the running server instead of trusting a port', () => {
	it('reports the vite dev server, which answers the HMR client path with JavaScript', async () => {
		expect(await is_development_server_for({ ok: true, type: JAVASCRIPT })).toBe(true)
	})

	it('probes the HMR client path on the base URL under test', async () => {
		const { request, probed } = fake_request({ ok: true, type: JAVASCRIPT })

		await security_headers_e2e.is_development_server(request, BASE_URL)

		expect(probed).toStrictEqual([VITE_CLIENT_URL])
	})

	// The Worker preview has no such route: SvelteKit answers 404 with its error page. This is the
	// case that MUST run the assertions — whatever port the preview happens to listen on.
	it('does not report a built app, which has no HMR client route', async () => {
		expect(await is_development_server_for({ ok: false, type: HTML })).toBe(false)
	})

	it('does not report a 200 that is not the client script, such as a catch-all page', async () => {
		expect(await is_development_server_for({ ok: true, type: HTML })).toBe(false)
	})
})

// Every answer short of a positively identified dev server has to run the assertions. Reporting
// "dev server" on a failed probe is exactly the silent hole this replaced.
describe('is_development_server — an inconclusive probe keeps the coverage', () => {
	it('reports no dev server when a response declares no content type at all', async () => {
		expect(
			await security_headers_e2e.is_development_server({ get: get_untyped_response }, BASE_URL),
		).toBe(false)
	})

	it('reports no dev server when there is no base URL to probe, and probes nothing', async () => {
		const { request, probed } = fake_request({ ok: true, type: JAVASCRIPT })

		expect(await security_headers_e2e.is_development_server(request, undefined)).toBe(false)
		expect(probed).toStrictEqual([])
	})

	it('reports no dev server when the base URL is empty', async () => {
		const { request } = fake_request({ ok: true, type: JAVASCRIPT })

		expect(await security_headers_e2e.is_development_server(request, '')).toBe(false)
	})

	// An unreachable origin is exactly when a port has drifted — the moment coverage must NOT vanish.
	it('reports no dev server when the probe cannot reach the server', async () => {
		expect(await security_headers_e2e.is_development_server({ get: get_refused }, BASE_URL)).toBe(
			false,
		)
	})

	it('reports no dev server when the base URL is not a URL', async () => {
		const { request } = fake_request({ ok: true, type: JAVASCRIPT })

		expect(await security_headers_e2e.is_development_server(request, 'not-a-url')).toBe(false)
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
