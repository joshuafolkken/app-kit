import path from 'node:path'
import { port_seed_fixture } from '#dast/port-seed-fixture.js'
import type { PreviewHandle } from '#dast/preview.js'
import { EnvironmentError } from '#process/environment-error.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { CaptureOutcome, ShotBrowser, ShotPage } from './capture.js'
import { shot_routes } from './routes.js'
import { app_shot, type ShotDependencies, type ShotResult } from './shot.js'

const CWD = '/consumer/project'
const SUCCESS = 0
const BUILD_FAILURE = 2
const OK_STATUS = 200
const NOT_FOUND_STATUS = 404

const ROOT_ROUTE = '/'
const BLOG_ROUTE = '/blog'
const MISSING_ROUTE = '/missing'
const NAVIGATION_CRASH = 'navigation crashed'

const { BASE_PREVIEW_PORT, TEST_SEED, SEEDED_PREVIEW_PORT } = port_seed_fixture
const seed = port_seed_fixture.isolate()

function url_for(route: string, port: number = BASE_PREVIEW_PORT): string {
	return `http://127.0.0.1:${String(port)}${route}`
}

function file_in(name: string): string {
	return path.join(CWD, shot_routes.OUTPUT_DIR, name)
}

interface HarnessOptions {
	build_status?: number
	// Status per navigated URL; anything not listed answers 200.
	statuses?: Record<string, number>
	playwright_missing?: boolean
	// Makes the capture loop throw, to prove the server is still torn down.
	capture_throws?: boolean
}

interface HarnessState {
	// Step names in the order they ran, so the sequence itself is asserted — clearing the planned
	// files AFTER capturing them would delete the very images the run just produced.
	order: Array<string>
	preflights: number
	prepared: Array<ReadonlyArray<string>>
	builds: number
	preview_ports: Array<number>
	boots: number
	stops: number
	browser_closes: number
	urls: Array<string>
	screenshots: Array<string>
}

function make_state(): HarnessState {
	return {
		order: [],
		preflights: 0,
		prepared: [],
		builds: 0,
		preview_ports: [],
		boots: 0,
		stops: 0,
		browser_closes: 0,
		urls: [],
		screenshots: [],
	}
}

function make_handle(state: HarnessState): PreviewHandle {
	return {
		stop: () => {
			state.stops += 1
		},
		output: () => '',
		has_exited: () => false,
		group_id: () => undefined,
	}
}

function status_for(options: HarnessOptions, url: string): number {
	return options.statuses?.[url] ?? OK_STATUS
}

function make_page(state: HarnessState, options: HarnessOptions): ShotPage {
	return {
		async goto(url: string) {
			state.order.push('capture')
			state.urls.push(url)
			if (options.capture_throws === true) throw new Error(NAVIGATION_CRASH)

			return { status: () => status_for(options, url) }
		},
		async screenshot(screenshot_options: { path: string }) {
			state.screenshots.push(screenshot_options.path)

			return undefined
		},
		async close() {
			// The page is closed per capture; the assertions here are about the browser and server.
		},
	}
}

function make_browser(state: HarnessState, options: HarnessOptions): ShotBrowser {
	return {
		async newPage() {
			return make_page(state, options)
		},
		async close() {
			state.browser_closes += 1
		},
	}
}

function make_dependencies(state: HarnessState, options: HarnessOptions): ShotDependencies {
	return {
		preflight_playwright(): void {
			state.order.push('preflight')
			state.preflights += 1
			if (options.playwright_missing === true) throw new EnvironmentError('no playwright')
		},
		prepare_output(_cwd: string, files: ReadonlyArray<string>): void {
			state.order.push('prepare')
			state.prepared.push(files)
		},
		build(): number {
			state.order.push('build')
			state.builds += 1

			return options.build_status ?? SUCCESS
		},
		async start_preview(_cwd: string, port: number): Promise<PreviewHandle> {
			state.order.push('boot')
			state.preview_ports.push(port)
			state.boots += 1

			return make_handle(state)
		},
		async launch(): Promise<ShotBrowser> {
			return make_browser(state, options)
		},
	}
}

interface Harness {
	state: HarnessState
	run: (argv: ReadonlyArray<string>) => Promise<ShotResult>
}

function harness(options: HarnessOptions = {}): Harness {
	const state = make_state()
	const deps = make_dependencies(state, options)

	return { state, run: async (argv) => await app_shot.run_shot(CWD, argv, deps) }
}

async function run(argv: ReadonlyArray<string>, options: HarnessOptions = {}): Promise<Harness> {
	const created = harness(options)

	await created.run(argv)

	return created
}

beforeEach(() => {
	seed.clear()
})

afterEach(() => {
	seed.restore()
})

describe('app_shot.run_shot builds and boots once', () => {
	it('builds once and boots the preview once for every requested route', async () => {
		const { state } = await run([ROOT_ROUTE, BLOG_ROUTE, '/blog/post'])

		expect(state.builds).toBe(1)
		expect(state.boots).toBe(1)
	})

	it('captures every route against that single server', async () => {
		const { state } = await run([ROOT_ROUTE, BLOG_ROUTE])

		expect(state.urls).toStrictEqual([url_for(ROOT_ROUTE), url_for(BLOG_ROUTE)])
	})

	it('writes each route to its planned file under the fixed output directory', async () => {
		const { state } = await run([ROOT_ROUTE, BLOG_ROUTE])

		expect(state.screenshots).toStrictEqual([file_in('root.png'), file_in('blog.png')])
	})

	it('preflights, builds, clears the planned files, boots, then captures — in that order', async () => {
		const { state } = await run([ROOT_ROUTE])

		expect(state.order).toStrictEqual(['preflight', 'build', 'prepare', 'boot', 'capture'])
	})

	it('clears exactly the files it is about to write, so a failed route leaves none stale', async () => {
		const { state } = await run([ROOT_ROUTE, BLOG_ROUTE])

		expect(state.prepared).toStrictEqual([[file_in('root.png'), file_in('blog.png')]])
	})

	it('clears only the mobile files on a mobile run, leaving the desktop images alone', async () => {
		const { state } = await run([ROOT_ROUTE, shot_routes.MOBILE_FLAG])

		expect(state.prepared).toStrictEqual([[file_in('root-mobile.png')]])
	})

	it('follows the seeded preview port rather than hardcoding the base', async () => {
		seed.set(TEST_SEED)

		const { state } = await run([ROOT_ROUTE])

		expect(state.preview_ports).toStrictEqual([SEEDED_PREVIEW_PORT])
	})
})

describe('app_shot.run_shot teardown', () => {
	it('stops the preview server and closes the browser after a successful run', async () => {
		const created = harness()
		const result = await created.run([ROOT_ROUTE])

		expect(result.status).toBe(SUCCESS)
		expect(created.state.stops).toBe(1)
		expect(created.state.browser_closes).toBe(1)
	})

	it('still stops the server and closes the browser when a capture throws', async () => {
		const created = harness({ capture_throws: true })

		await expect(created.run([ROOT_ROUTE])).rejects.toThrow(NAVIGATION_CRASH)
		expect(created.state.stops).toBe(1)
		expect(created.state.browser_closes).toBe(1)
	})
})

describe('app_shot.run_shot failure paths', () => {
	const missing_statuses = { [url_for(MISSING_ROUTE)]: NOT_FOUND_STATUS }

	it('fails explicitly when a requested route does not exist', async () => {
		const created = harness({ statuses: missing_statuses })
		const result = await created.run([ROOT_ROUTE, MISSING_ROUTE])

		expect(result.status).toBe(app_shot.CAPTURE_FAILURE_STATUS)
	})

	it('writes no image for the missing route, but keeps the one that answered', async () => {
		const { state } = await run([ROOT_ROUTE, MISSING_ROUTE], { statuses: missing_statuses })

		expect(state.screenshots).toStrictEqual([file_in('root.png')])
	})

	it('does not build when the project has no Playwright installed', async () => {
		const created = harness({ playwright_missing: true })

		await expect(created.run([ROOT_ROUTE])).rejects.toThrow(EnvironmentError)
		expect(created.state.builds).toBe(0)
	})

	it('rejects a relative route before doing any work', async () => {
		const created = harness()

		await expect(created.run(['blog'])).rejects.toThrow(EnvironmentError)
		expect(created.state.preflights).toBe(0)
	})
})

describe('app_shot.run_shot on a failed build', () => {
	it('reports the build status without booting the preview or capturing anything', async () => {
		const created = harness({ build_status: BUILD_FAILURE })
		const result = await created.run([ROOT_ROUTE])

		expect(result.status).toBe(BUILD_FAILURE)
		expect(created.state.boots).toBe(0)
		expect(result.outcomes).toStrictEqual([])
	})

	it('does not touch the output directory when the build failed', async () => {
		const { state } = await run([ROOT_ROUTE], { build_status: BUILD_FAILURE })

		expect(state.prepared).toStrictEqual([])
	})
})

function outcome_for(route: string, status: number): CaptureOutcome {
	return { route, file: file_in('x.png'), status }
}

describe('app_shot.describe_result', () => {
	it('names the output directory and the count when every route succeeded', () => {
		const summary = app_shot.describe_result([outcome_for(ROOT_ROUTE, OK_STATUS)])

		expect(summary).toContain('captured 1 route(s)')
		expect(summary).toContain(shot_routes.OUTPUT_DIR)
	})

	it('lists the file each successful route was written to', () => {
		const summary = app_shot.describe_result([outcome_for(ROOT_ROUTE, OK_STATUS)])

		expect(summary).toContain(file_in('x.png'))
	})

	it('reports the failing route with its status rather than a bare count', () => {
		const summary = app_shot.describe_result([
			outcome_for(ROOT_ROUTE, OK_STATUS),
			outcome_for(MISSING_ROUTE, NOT_FOUND_STATUS),
		])

		expect(summary).toContain('1 of 2 route(s) failed')
		expect(summary).toContain('/missing → HTTP 404')
	})
})

describe('app_shot.to_status', () => {
	it('succeeds only when every route answered', () => {
		expect(app_shot.to_status([outcome_for(ROOT_ROUTE, OK_STATUS)])).toBe(SUCCESS)
	})

	it('fails when any route did not', () => {
		const outcomes = [
			outcome_for(ROOT_ROUTE, OK_STATUS),
			outcome_for(MISSING_ROUTE, NOT_FOUND_STATUS),
		]

		expect(app_shot.to_status(outcomes)).toBe(app_shot.CAPTURE_FAILURE_STATUS)
	})
})
