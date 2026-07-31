// The stack-universal half of a security-headers E2E, shipped so consumers stop re-deriving it.
//
// `README.md` and the distributed `dast.yml` both justify running the full ZAP baseline nightly
// rather than per-PR by pointing at "the Docker-free E2E assertions" — a net app-kit described but
// never handed over, so every consumer wrote its own (app-kit#120). These are that net.
//
// Placed beside `headers.ts` on purpose: the baseline expectations derive from SECURITY_HEADERS
// rather than restating it, so adding a header upstream widens every consumer's E2E on the next
// update instead of leaving a seeded copy half-covering the surface.
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

function baseline_header_problems(headers: Record<string, string>): Array<string> {
	return security_headers.SECURITY_HEADERS.filter(
		([name, value]) => headers[name.toLowerCase()] !== value,
	).map(([name, value]) => {
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

/** Every way the response departs from the app-kit header baseline. Empty means it matches. */
function baseline_problems(response: HeaderSource | null): Array<string> {
	if (response === null) return [NO_RESPONSE]

	return baseline_header_problems(response.headers())
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

/** Give the page a bounded window to finish loading; a polling widget may never reach idle. */
async function settle(page: SettlePage, timeout_ms: number = SETTLE_TIMEOUT_MS): Promise<void> {
	try {
		await page.waitForLoadState('networkidle', { timeout: timeout_ms })
	} catch {
		// Still busy after the window — report on whatever has arrived by now.
	}
}

const security_headers_e2e = {
	SETTLE_TIMEOUT_MS,
	baseline_problems,
	csp_problems,
	watch_violations,
	settle,
}

export { security_headers_e2e }
