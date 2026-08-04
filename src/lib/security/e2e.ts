// The stack-universal half of a security-headers E2E, shipped so consumers stop re-deriving it.
//
// `README.md` and the distributed `dast.yml` both justify running the full ZAP baseline nightly
// rather than per-PR by pointing at "the Docker-free E2E assertions" — a net app-kit described but
// never handed over, so every consumer wrote its own (app-kit#120). These are that net.
//
// Placed beside `headers.ts` on purpose: the baseline expectations derive from what
// `apply_security_headers` composes rather than restating it, so adding a header upstream widens
// every consumer's E2E on the next update instead of leaving a seeded copy half-covering the
// surface — and a consumer's own `extra` list drives the assertion as well as the header.
//
// Every check REPORTS problems rather than asserting them, so the seeded spec reads
// `expect(baseline_problems(response)).toStrictEqual([])` and keeps its `expect` where the linter
// (and the next reader) can see it — a helper that threw internally would leave the distributed
// file looking assertion-free and failing `sonarjs/assertions-in-tests` in every consumer.
//
// Deliberately free of any `@playwright/test` import, type-only included. Each function takes the
// narrow structural slice of `Page` / `Response` it actually drives, which a real Playwright object
// satisfies. That keeps this subpath dependency-free for consumers and lets the whole module be
// unit-tested with plain object fakes — no browser, and no restricted `as` cast to build one.
import { security_headers } from './headers.js'

/** Satisfied by a Playwright `Response`, and by a plain `{ headers: () => ({}) }` in a test. */
interface HeaderSource {
	headers: () => Record<string, string>
}

// The awaited results are discarded, so every port below returns `Promise<unknown>` — Playwright
// has already changed one of these (`exposeFunction` now resolves to a `Disposable`), and a port
// that pinned the resolved type would break on the next such change for no benefit.

/** The slice of a Playwright `Page` the violation watcher installs its bridge through. */
interface ViolationPage {
	exposeFunction: (name: string, report: (detail: string) => void) => Promise<unknown>
	addInitScript: (script: () => void) => Promise<unknown>
}

/** The slice of a Playwright `Page` the bounded settle window waits on. */
interface SettlePage {
	waitForLoadState: (state: 'networkidle', options: { timeout: number }) => Promise<unknown>
}

/** Satisfied by a Playwright `APIResponse`, and by a plain object in a test. */
interface ProbeResponse {
	ok: () => boolean
	headers: () => Record<string, string>
}

/** The slice of a Playwright `APIRequestContext` the runtime probe drives (`page.request`). */
interface ProbeRequest {
	get: (url: string) => Promise<ProbeResponse>
}

declare global {
	/**
	 * Bridge `watch_violations` installs into the page. Prefixed because this declaration reaches
	 * every consumer that imports this module.
	 */
	var app_kit_report_csp_violation: (detail: string) => void
}

const CSP_HEADER = 'content-security-policy'
const SCRIPT_SRC = 'script-src'
const STYLE_SRC = 'style-src'
const UNSAFE_INLINE = "'unsafe-inline'"
const NONCE_PREFIX = "'nonce-"
const ABSENT = '(absent)'
// vite dev serves its HMR client from this path as JavaScript; a built app has no such route, so the
// Worker preview (and production) answers 404 with the SvelteKit error page. Verified against both.
const VITE_CLIENT_PATH = '/@vite/client'
const CONTENT_TYPE_HEADER = 'content-type'
const JAVASCRIPT_TYPE = 'javascript'
/** The reason a seeded spec skips: shipped here so no consumer copy has to restate it. */
const DEV_SERVER_REASON = 'security headers come from the Worker runtime, not the vite dev server'
const NO_RESPONSE = 'the navigation produced no response to assert on'
const VIOLATION_BRIDGE = 'app_kit_report_csp_violation'
// Bounded rather than an unqualified `networkidle` wait: a page carrying ads or any other polling
// widget never reaches idle, and an E2E that hangs there is worse than one that reports the
// violations seen so far.
const SETTLE_TIMEOUT_MS = 8000

/** The source list of a single directive, or `undefined` when the policy does not declare it. */
function directive_of(csp: string, name: string): string | undefined {
	const found = csp
		.split(';')
		.map((part) => part.trim())
		.find((part) => part === name || part.startsWith(`${name} `))

	return found?.slice(name.length).trim()
}

function header_problems(
	headers: Record<string, string>,
	expected: ReadonlyArray<readonly [string, string]>,
): Array<string> {
	return expected
		.filter(([name, value]) => headers[name.toLowerCase()] !== value)
		.map(([name, value]) => {
			const served = headers[name.toLowerCase()] ?? ABSENT

			return `${name}: expected "${value}", served "${served}"`
		})
}

// The script surface is the one that executes code, so both halves are reported: the nonce must be
// there (proving SvelteKit's `kit.csp` wiring survived the adapter) and `'unsafe-inline'` must not
// (a policy that allows it is not meaningfully protecting anything).
function script_source_problems(csp: string): Array<string> {
	const sources = directive_of(csp, SCRIPT_SRC)
	if (sources === undefined) return [`${SCRIPT_SRC} is not declared`]

	const problems: Array<string> = []

	if (!sources.includes(NONCE_PREFIX)) problems.push(`${SCRIPT_SRC} is not nonce-based: ${sources}`)
	if (sources.includes(UNSAFE_INLINE)) problems.push(`${SCRIPT_SRC} allows ${UNSAFE_INLINE}`)

	return problems
}

// The mirror image of the script rule, and just as deliberate: SvelteKit's `app.html` ships an
// inline `style` attribute and Svelte transitions inject `<style>` at runtime, so a `style-src`
// without `'unsafe-inline'` white-screens any page that animates. Inline style cannot execute JS.
function style_source_problems(csp: string): Array<string> {
	const sources = directive_of(csp, STYLE_SRC)
	if (sources === undefined) return [`${STYLE_SRC} is not declared`]
	if (sources.includes(UNSAFE_INLINE)) return []

	return [`${STYLE_SRC} must keep ${UNSAFE_INLINE} for Svelte transition styles: ${sources}`]
}

/**
 * Every way the response departs from the header set the hook applies. Empty means it matches.
 *
 * Pass the SAME `extra` array given to `apply_security_headers`, hoisted into a module both the hook
 * and the spec import. Without it the expectation is the bare baseline, so a documented OVERRIDE —
 * a `Permissions-Policy` denying more than the baseline does, an `X-Frame-Options` deliberately
 * relaxed to SAMEORIGIN — is reported as a departure even though the hook applied exactly that
 * (app-kit#154). Passing it also puts the EXTENDING entries (Strict-Transport-Security, a
 * site-specific Content-Security-Policy) under the same assertion, which the baseline never covered.
 */
function baseline_problems(
	response: HeaderSource | null,
	extra: ReadonlyArray<readonly [string, string]> = [],
): Array<string> {
	if (response === null) return [NO_RESPONSE]

	return header_problems(response.headers(), security_headers.composed_headers(extra))
}

/** Every way the served policy departs from the nonce-based one `kit.csp` emits. */
function csp_problems(response: HeaderSource | null): Array<string> {
	if (response === null) return [NO_RESPONSE]

	const csp = response.headers()[CSP_HEADER] ?? ''
	if (csp === '') return [`no ${CSP_HEADER} header on the response`]

	return [...script_source_problems(csp), ...style_source_problems(csp)]
}

/**
 * Start collecting the CSP violations the browser reports, before any page script runs. Call this
 * BEFORE `page.goto` — the returned array fills in as the page loads.
 */
async function watch_violations(page: ViolationPage): Promise<Array<string>> {
	const violations: Array<string> = []

	await page.exposeFunction(VIOLATION_BRIDGE, (detail: string) => {
		violations.push(detail)
	})

	await page.addInitScript(() => {
		document.addEventListener('securitypolicyviolation', (event) => {
			const source = event.sourceFile === '' ? 'inline' : event.sourceFile

			globalThis.app_kit_report_csp_violation(
				`${event.violatedDirective}: ${event.blockedURI} (${source})`,
			)
		})
	})

	return violations
}

function is_vite_client_response(response: ProbeResponse): boolean {
	if (!response.ok()) return false

	return (response.headers()[CONTENT_TYPE_HEADER] ?? '').includes(JAVASCRIPT_TYPE)
}

/**
 * Whether the run targets the vite dev server, which never processes `_headers` — the one case where
 * skipping the header assertions is honest rather than a hole.
 *
 * Asks the running server instead of comparing ports (app-kit#127). The seeded spec used to skip on
 * `!baseURL.includes('4173')`, a port restated in a file app-kit never rewrites: a consumer who moved
 * their preview port got two silently skipped tests and a green run with no header coverage at all.
 * Playwright's own config is no help — it derives `baseURL` FROM `webServer.port`, so the two always
 * agree — and the command string cannot be read either, since `preview` here is `wrangler dev`.
 *
 * Fail-safe in the coverage direction: no base URL, an unreachable origin, or any answer that is not
 * positively the vite client all report `false`, so the assertions RUN. The same reasoning as
 * `should_scan` in verify.ts — a security check must never be skipped silently. If vite ever moves
 * its client path, that bias makes dev runs fail loudly here instead of going quietly uncovered.
 */
async function is_development_server(
	request: ProbeRequest,
	base_url: string | undefined,
): Promise<boolean> {
	if (base_url === undefined || base_url === '') return false

	try {
		return is_vite_client_response(await request.get(new URL(VITE_CLIENT_PATH, base_url).href))
	} catch {
		// Refused, unresolvable, or a base URL that is not a URL — inconclusive, so keep the coverage.
		return false
	}
}

/** Give the page a bounded window to finish loading; a polling widget may never reach idle. */
async function settle(page: SettlePage, timeout_ms: number = SETTLE_TIMEOUT_MS): Promise<void> {
	try {
		await page.waitForLoadState('networkidle', { timeout: timeout_ms })
	} catch {
		// Still busy after the window — report on whatever has arrived by now.
	}
}

const security_headers_e2e = {
	DEV_SERVER_REASON,
	SETTLE_TIMEOUT_MS,
	baseline_problems,
	csp_problems,
	is_development_server,
	watch_violations,
	settle,
}

export { security_headers_e2e }
