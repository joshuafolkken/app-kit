import path from 'node:path'
import { EnvironmentError } from '#process/environment-error.js'
import { describe, expect, it } from 'vitest'
import { shot_routes } from './routes.js'

const OUTPUT_DIR = path.join('test-results', 'screenshots')

const ROOT_ROUTE = '/'
const BLOG_ROUTE = '/blog'
const BLOG_FILE = path.join(OUTPUT_DIR, 'blog.png')
const ROOT_FILE = path.join(OUTPUT_DIR, 'root.png')
const BLOG_MOBILE_FILE = path.join(OUTPUT_DIR, 'blog-mobile.png')

function files_for(argv: ReadonlyArray<string>): Array<string> {
	return shot_routes.build_plan(argv).requests.map((request) => request.file)
}

describe('shot_routes.normalize_route', () => {
	it('keeps the root route as a single slash', () => {
		expect(shot_routes.normalize_route('/')).toBe('/')
	})

	it('drops a trailing slash so /blog/ and /blog name one capture', () => {
		expect(shot_routes.normalize_route('/blog/')).toBe('/blog')
	})

	it('drops repeated trailing slashes', () => {
		expect(shot_routes.normalize_route('/blog///')).toBe('/blog')
	})
})

describe('shot_routes.to_output_path', () => {
	it('names the root route root.png', () => {
		expect(shot_routes.to_output_path(ROOT_ROUTE, false)).toBe(ROOT_FILE)
	})

	it('flattens a nested route into a single dash-joined file name', () => {
		expect(shot_routes.to_output_path('/blog/my-post', false)).toBe(
			path.join(OUTPUT_DIR, 'blog-my-post.png'),
		)
	})

	it('collapses characters that are not portable in a file name', () => {
		expect(shot_routes.to_output_path('/search?q=a b', false)).toBe(
			path.join(OUTPUT_DIR, 'search-q-a-b.png'),
		)
	})

	it('lower-cases the slug so two routes cannot collide on a case-insensitive file system', () => {
		expect(shot_routes.to_output_path('/Blog', false)).toBe(BLOG_FILE)
	})

	it('suffixes a mobile capture so it does not overwrite the desktop one', () => {
		expect(shot_routes.to_output_path(BLOG_ROUTE, true)).toBe(BLOG_MOBILE_FILE)
	})
})

describe('shot_routes.build_plan', () => {
	it('plans one request per route, in the given order', () => {
		expect(files_for([ROOT_ROUTE, BLOG_ROUTE])).toStrictEqual([ROOT_FILE, BLOG_FILE])
	})

	it('collapses duplicate routes that normalize to the same capture', () => {
		expect(files_for([BLOG_ROUTE, '/blog/'])).toStrictEqual([BLOG_FILE])
	})
})

describe('shot_routes.build_plan viewport selection', () => {
	it('uses the desktop viewport by default', () => {
		expect(shot_routes.build_plan([ROOT_ROUTE]).viewport).toStrictEqual(
			shot_routes.DESKTOP_VIEWPORT,
		)
	})

	it('switches to the mobile viewport when the mobile flag is passed', () => {
		const plan = shot_routes.build_plan([ROOT_ROUTE, shot_routes.MOBILE_FLAG])

		expect(plan.viewport).toStrictEqual(shot_routes.MOBILE_VIEWPORT)
		expect(plan.is_mobile).toBe(true)
	})

	it('does not treat the mobile flag as a route', () => {
		expect(files_for([BLOG_ROUTE, shot_routes.MOBILE_FLAG])).toStrictEqual([BLOG_MOBILE_FILE])
	})
})

describe('shot_routes.build_plan rejects a plan that would capture nothing', () => {
	it('fails with usage rather than planning nothing when no route is given', () => {
		expect(() => shot_routes.build_plan([])).toThrow(EnvironmentError)
	})

	it('fails with usage when only the mobile flag is given', () => {
		expect(() => shot_routes.build_plan([shot_routes.MOBILE_FLAG])).toThrow(/Usage: josh-app shot/u)
	})

	it('rejects a relative route instead of guessing the leading slash', () => {
		expect(() => shot_routes.build_plan(['blog'])).toThrow(/expects absolute routes/u)
	})

	it('names the offending argument when a route is relative', () => {
		expect(() => shot_routes.build_plan([ROOT_ROUTE, 'blog'])).toThrow(/"blog"/u)
	})
})

describe('shot_routes.build_plan rejects two routes that flatten to one file', () => {
	const COLLIDING = ['/blog/post', '/blog-post']

	it('refuses rather than silently overwriting one image with the other', () => {
		expect(() => shot_routes.build_plan(COLLIDING)).toThrow(EnvironmentError)
	})

	it('names both routes and the file they collide on', () => {
		expect(() => shot_routes.build_plan(COLLIDING)).toThrow(/\/blog\/post and \/blog-post/u)
	})

	it('still collapses the SAME route written two ways, which is not a collision', () => {
		expect(files_for([BLOG_ROUTE, '/blog/'])).toStrictEqual([BLOG_FILE])
	})
})
