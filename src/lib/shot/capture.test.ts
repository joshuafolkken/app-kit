import path from 'node:path'
import { EnvironmentError } from '#process/environment-error.js'
import { describe, expect, it } from 'vitest'
import {
	capture,
	type BrowserLauncher,
	type CaptureOutcome,
	type ShotBrowser,
	type ShotPage,
} from './capture.js'
import type { ShotRequest, Viewport } from './routes.js'

const PORT = 4173
const OK_STATUS = 200
const NOT_FOUND_STATUS = 404
const REDIRECT_STATUS = 301
const SERVER_ERROR_STATUS = 500

const PROJECT = '/consumer/project'
const BLOG_ROUTE = '/blog'
const BLOG_URL = 'http://127.0.0.1:4173/blog'
const BLOG_FILE = '/project/test-results/screenshots/blog.png'

const VIEWPORT: Viewport = { width: 1280, height: 800 }
const REQUEST: ShotRequest = { route: BLOG_ROUTE, file: BLOG_FILE }

interface ScreenshotCall {
	path: string
	fullPage: boolean
}

interface BrowserState {
	urls: Array<string>
	viewports: Array<Viewport>
	screenshots: Array<ScreenshotCall>
	closed_pages: number
}

function make_state(): BrowserState {
	return { urls: [], viewports: [], screenshots: [], closed_pages: 0 }
}

function make_response(status: number | undefined): { status: () => number } | undefined {
	return status === undefined ? undefined : { status: () => status }
}

// A page whose every navigation answers with `status`, recording what it was asked to do. Written
// with plain promise-returning functions rather than `async` bodies so the fake stays a one-liner
// per method.
function make_page(state: BrowserState, status: number | undefined): ShotPage {
	return {
		async goto(url: string) {
			state.urls.push(url)

			return make_response(status)
		},
		async screenshot(options: ScreenshotCall) {
			state.screenshots.push(options)

			return undefined
		},
		async close() {
			state.closed_pages += 1
		},
	}
}

function make_browser(state: BrowserState, status: number | undefined): ShotBrowser {
	return {
		async newPage(options: { viewport: Viewport }) {
			state.viewports.push(options.viewport)

			return make_page(state, status)
		},
		async close() {
			// Nothing to record: the orchestration suite is what asserts the browser is closed.
		},
	}
}

async function capture_with(status: number | undefined): Promise<{
	state: BrowserState
	outcome: CaptureOutcome
}> {
	const state = make_state()
	const outcome = await capture.capture_one(make_browser(state, status), VIEWPORT, PORT, REQUEST)

	return { state, outcome }
}

function outcome_with(status: number): CaptureOutcome {
	return { route: BLOG_ROUTE, file: BLOG_FILE, status }
}

// A resolver that only knows the named specifier, so the fallback order is what is under test
// rather than whatever happens to be installed on the machine running the suite.
function only(specifier: string): (cwd: string, requested: string) => string | undefined {
	return (_cwd, requested) => (requested === specifier ? `/resolved/${specifier}` : undefined)
}

function resolve_none(): undefined {
	return undefined
}

function resolve_any(_cwd: string, specifier: string): string {
	return `/resolved/${specifier}`
}

describe('capture.build_page_url', () => {
	it('targets the loopback preview server on the resolved port', () => {
		expect(capture.build_page_url(PORT, BLOG_ROUTE)).toBe(BLOG_URL)
	})

	it('keeps the root route a bare slash rather than doubling it', () => {
		expect(capture.build_page_url(PORT, '/')).toBe('http://127.0.0.1:4173/')
	})
})

describe('capture.is_capture_ok', () => {
	it('accepts a 2xx response', () => {
		expect(capture.is_capture_ok(outcome_with(OK_STATUS))).toBe(true)
	})

	it('accepts a redirect, which still renders a real page', () => {
		expect(capture.is_capture_ok(outcome_with(REDIRECT_STATUS))).toBe(true)
	})

	it('rejects a route that does not exist', () => {
		expect(capture.is_capture_ok(outcome_with(NOT_FOUND_STATUS))).toBe(false)
	})

	it('rejects a server error', () => {
		expect(capture.is_capture_ok(outcome_with(SERVER_ERROR_STATUS))).toBe(false)
	})

	it('rejects a navigation that produced no response at all', () => {
		expect(capture.is_capture_ok(outcome_with(capture.MISSING_STATUS))).toBe(false)
	})
})

describe('capture.capture_one on a reachable route', () => {
	it('reports the route, its planned file and the status it answered with', async () => {
		const { outcome } = await capture_with(OK_STATUS)

		expect(outcome).toStrictEqual({ route: BLOG_ROUTE, file: BLOG_FILE, status: OK_STATUS })
	})

	it('writes a full-page screenshot to the planned file', async () => {
		const { state } = await capture_with(OK_STATUS)

		expect(state.screenshots).toStrictEqual([{ path: BLOG_FILE, fullPage: true }])
	})

	it('opens the page at the requested viewport', async () => {
		const { state } = await capture_with(OK_STATUS)

		expect(state.viewports).toStrictEqual([VIEWPORT])
	})

	it('navigates to the preview URL built from the port and route', async () => {
		const { state } = await capture_with(OK_STATUS)

		expect(state.urls).toStrictEqual([BLOG_URL])
	})
})

describe('capture.capture_one on a route that fails', () => {
	it('writes no screenshot for a route that does not exist', async () => {
		const { state, outcome } = await capture_with(NOT_FOUND_STATUS)

		expect(outcome.status).toBe(NOT_FOUND_STATUS)
		expect(state.screenshots).toStrictEqual([])
	})

	it('reports a response-less navigation as the missing status', async () => {
		const { state, outcome } = await capture_with(undefined)

		expect(outcome.status).toBe(capture.MISSING_STATUS)
		expect(state.screenshots).toStrictEqual([])
	})

	it('closes the page even when the route failed', async () => {
		const { state } = await capture_with(NOT_FOUND_STATUS)

		expect(state.closed_pages).toBe(1)
	})
})

describe('capture.is_missing_browser', () => {
	it('recognizes the missing-executable launch failure', () => {
		expect(capture.is_missing_browser(new Error("Executable doesn't exist at /x/chrome"))).toBe(
			true,
		)
	})

	it('recognizes the install hint Playwright appends', () => {
		expect(capture.is_missing_browser(new Error('Please run: npx playwright install'))).toBe(true)
	})

	it('leaves an unrelated launch failure to keep its stack trace', () => {
		expect(capture.is_missing_browser(new Error('EACCES'))).toBe(false)
	})
})

describe('capture.to_chromium', () => {
	const launcher: BrowserLauncher = { launch: async () => make_browser(make_state(), OK_STATUS) }

	it('reads the named export an ESM entry exposes', () => {
		expect(capture.to_chromium({ chromium: launcher })).toBe(launcher)
	})

	it('falls back to the default interop key, which is all the CommonJS entry exposes', () => {
		expect(capture.to_chromium({ default: { chromium: launcher } })).toBe(launcher)
	})

	it('raises the actionable error when the module exposes neither', () => {
		expect(() => capture.to_chromium({})).toThrow(EnvironmentError)
	})
})

describe('capture.resolve_playwright_entry', () => {
	it('prefers @playwright/test, the package a kit-distributed project declares', () => {
		expect(capture.resolve_playwright_entry(PROJECT, resolve_any)).toBe(
			'/resolved/@playwright/test',
		)
	})

	it('falls back to plain playwright for a project that depends on it directly', () => {
		expect(capture.resolve_playwright_entry(PROJECT, only('playwright'))).toBe(
			'/resolved/playwright',
		)
	})

	it('raises an actionable error for a project without Playwright', () => {
		expect(() => capture.resolve_playwright_entry(PROJECT, resolve_none)).toThrow(EnvironmentError)
	})

	it('names the install command in that error rather than only the failure', () => {
		expect(() => capture.resolve_playwright_entry(PROJECT, resolve_none)).toThrow(/pnpm add -D/u)
	})

	it('resolves from the project tree, not the running bundle, with the real resolver', () => {
		const entry = capture.resolve_playwright_entry(process.cwd())

		expect(entry.startsWith(process.cwd())).toBe(true)
		expect(entry).toContain(path.join('@playwright', 'test'))
	})
})
