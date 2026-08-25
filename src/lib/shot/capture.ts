import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { port_owner } from '#dast/port-owner.js'
import { EnvironmentError } from '#process/environment-error.js'
import type { ShotRequest, Viewport } from './routes.js'

// The Playwright bridge for `josh-app shot`. Kept apart from the orchestration in shot.ts so the
// browser is the ONLY thing this file knows about: shot.ts owns the build and the preview server,
// routes.ts owns the paths, and this module turns a plan into PNG files.
//
// Playwright is resolved from the CONSUMER project, not from the running bundle. `josh-app` is an
// esbuild bundle that lives under the consumer's node_modules/.pnpm/…/@joshuafolkken/app-kit/, and
// pnpm's strict layout means a module resolved relative to that file sees app-kit's own
// dependencies — where Playwright is a devDependency and therefore absent for consumers. Resolving
// against the project's package.json instead finds the copy the project's own E2E suite uses.

// `@playwright/test` first: it is the package a kit-distributed project declares (the E2E suite
// imports it), and it re-exports the full browser API including `chromium`. Plain `playwright` is
// the fallback for a project that depends on it directly.
const PLAYWRIGHT_SPECIFIERS: ReadonlyArray<string> = ['@playwright/test', 'playwright']

const MANIFEST = 'package.json'

// A response-less navigation (a transport failure, or a data: URL) has no status to judge, so it is
// reported as a status the caller can only read as a failure.
const MISSING_STATUS = 0
const FIRST_ERROR_STATUS = 400

// Playwright reports a missing browser binary through the launch error rather than a typed error,
// so the message is the only thing to match on. Both spellings appear across versions.
const MISSING_BROWSER_MARKERS: ReadonlyArray<string> = [
	"Executable doesn't exist",
	'playwright install',
]

const PLAYWRIGHT_UNAVAILABLE_MESSAGE = [
	'josh-app shot requires Playwright in this project (it drives a real browser against the preview).',
	'Install it — `pnpm add -D @playwright/test` — and re-run.',
].join('\n')

const BROWSER_UNAVAILABLE_MESSAGE = [
	'josh-app shot could not launch Chromium: the browser binary is not installed.',
	'Run `pnpm exec playwright install chromium` and re-run.',
].join('\n')

// The slice of Playwright's surface this command uses, declared structurally rather than imported.
// It keeps the module free of a compile-time dependency on a package the consumer owns, and it is
// what makes the capture loop unit-testable against a fake browser.
interface ShotResponse {
	status: () => number
}

interface ShotPage {
	goto: (url: string, options: { waitUntil: 'load' }) => Promise<ShotResponse | undefined>
	screenshot: (options: { path: string; fullPage: boolean }) => Promise<unknown>
	close: () => Promise<void>
}

interface ShotBrowser {
	newPage: (options: { viewport: Viewport }) => Promise<ShotPage>
	close: () => Promise<void>
}

interface BrowserLauncher {
	launch: () => Promise<ShotBrowser>
}

// Both shapes the dynamic import can hand back. `require.resolve` names Playwright's CommonJS
// entry, and Node cannot statically detect that file's exports — `@playwright/test` assigns
// `module.exports` at runtime — so importing it by URL yields a namespace whose only useful key is
// `default`. Importing the ESM entry instead would give the named export directly, which is why
// both are read rather than either one assumed.
interface PlaywrightNamespace {
	chromium?: BrowserLauncher
	default?: { chromium?: BrowserLauncher }
}

// One capture's verdict. `status` is the HTTP status the navigation returned, which is what makes a
// route that does not exist an explicit failure instead of a PNG of the 404 page.
interface CaptureOutcome {
	route: string
	file: string
	status: number
}

function build_page_url(port: number, route: string): string {
	return `http://${port_owner.LOOPBACK_HOST}:${String(port)}${route}`
}

// A redirect still renders a real page, so only 4xx/5xx — and the response-less navigation the
// MISSING_STATUS sentinel stands for — count as a route that could not be photographed.
function is_status_ok(status: number): boolean {
	return status > MISSING_STATUS && status < FIRST_ERROR_STATUS
}

function is_capture_ok(outcome: CaptureOutcome): boolean {
	return is_status_ok(outcome.status)
}

// How a specifier is looked up, injectable so the fallback order and the missing-Playwright branch
// are testable without depending on what happens to be installed on the machine running the suite.
type SpecifierResolver = (cwd: string, specifier: string) => string | undefined

function default_resolve_from(cwd: string, specifier: string): string | undefined {
	try {
		return createRequire(path.join(cwd, MANIFEST)).resolve(specifier)
	} catch {
		return undefined
	}
}

// Resolve Playwright's entry point as the consumer project sees it, trying the specifiers in order.
// Throws the actionable EnvironmentError — never a stack trace — when the project has no Playwright
// installed at all.
function resolve_playwright_entry(
	cwd: string,
	resolve_from: SpecifierResolver = default_resolve_from,
): string {
	const entry = PLAYWRIGHT_SPECIFIERS.map((specifier) => resolve_from(cwd, specifier)).find(
		(resolved) => resolved !== undefined,
	)

	if (entry === undefined) throw new EnvironmentError(PLAYWRIGHT_UNAVAILABLE_MESSAGE)

	return entry
}

function to_chromium(namespace: PlaywrightNamespace): BrowserLauncher {
	const chromium = namespace.chromium ?? namespace.default?.chromium

	if (chromium === undefined) throw new EnvironmentError(PLAYWRIGHT_UNAVAILABLE_MESSAGE)

	return chromium
}

async function load_chromium(cwd: string): Promise<BrowserLauncher> {
	const entry = resolve_playwright_entry(cwd)

	return to_chromium((await import(pathToFileURL(entry).href)) as PlaywrightNamespace)
}

function is_missing_browser(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error)

	return MISSING_BROWSER_MARKERS.some((marker) => message.includes(marker))
}

// An uninstalled browser binary is a fixable prerequisite, exactly like `dast`'s stopped Docker
// daemon, so it gets the same plain actionable line. Anything else keeps its stack trace.
async function default_launch(cwd: string): Promise<ShotBrowser> {
	const chromium = await load_chromium(cwd)

	try {
		return await chromium.launch()
	} catch (error) {
		if (is_missing_browser(error)) {
			throw new EnvironmentError(BROWSER_UNAVAILABLE_MESSAGE, { cause: error })
		}

		throw error
	}
}

// One page per route rather than one reused page: a page carries over the previous route's scroll
// position and any state its scripts left behind, which is precisely what a verification screenshot
// must not inherit. `fullPage` captures the whole document — the viewport sets the width the layout
// responds to, and the reader wants everything below the fold too.
async function capture_one(
	browser: ShotBrowser,
	viewport: Viewport,
	port: number,
	request: ShotRequest,
): Promise<CaptureOutcome> {
	const page = await browser.newPage({ viewport })

	try {
		const response = await page.goto(build_page_url(port, request.route), { waitUntil: 'load' })
		const status = response?.status() ?? MISSING_STATUS

		if (is_status_ok(status)) {
			await page.screenshot({ path: request.file, fullPage: true })
		}

		return { route: request.route, file: request.file, status }
	} finally {
		await page.close()
	}
}

const capture = {
	MISSING_STATUS,
	FIRST_ERROR_STATUS,
	PLAYWRIGHT_UNAVAILABLE_MESSAGE,
	BROWSER_UNAVAILABLE_MESSAGE,
	build_page_url,
	is_status_ok,
	is_capture_ok,
	is_missing_browser,
	resolve_playwright_entry,
	to_chromium,
	default_launch,
	capture_one,
}

export { capture }
export type {
	BrowserLauncher,
	PlaywrightNamespace,
	CaptureOutcome,
	ShotBrowser,
	ShotPage,
	ShotResponse,
	SpecifierResolver,
}
