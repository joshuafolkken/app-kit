import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const ENCODING = 'utf8'
const RUNBOOK = 'docs/maintainers/cloudflare-deployment.md'
const RUNBOOK_LINK = 'maintainers/cloudflare-deployment.md'
const AUTH_LINK = '../deploy-authentication.md#after-moving-to-public-npm'
const LINE_COMMENT = /^\s*\/\//u
const ON_FAIL = /`onFail: (\w+)`/gu

interface PackageJson {
	devEngines: { packageManager: { onFail: string } }
}

interface WranglerRoute {
	pattern: string
	custom_domain?: boolean
}

interface WranglerConfig {
	name: string
	routes: Array<WranglerRoute>
}

// wrangler.jsonc carries only whole-line `//` comments, so dropping those lines leaves plain JSON.
function read_wrangler(): WranglerConfig {
	const json = readFileSync('wrangler.jsonc', ENCODING)
		.split('\n')
		.filter((line) => !LINE_COMMENT.test(line))
		.join('\n')

	return JSON.parse(json) as WranglerConfig
}

function custom_domains(config: WranglerConfig): Array<string> {
	return config.routes.filter((route) => route.custom_domain === true).map((route) => route.pattern)
}

function quoted_on_fail(runbook: string): Array<string> {
	return [...runbook.matchAll(ON_FAIL)].map((match) => match[1] ?? '')
}

// The runbook is what a person follows to rebuild the Cloudflare side; a Worker or domain
// renamed in wrangler.jsonc without the runbook would send them to the wrong resource.
describe('Cloudflare deployment runbook', () => {
	const runbook = readFileSync(RUNBOOK, ENCODING)
	const config = read_wrangler()

	it('names the Worker from wrangler.jsonc', () => {
		expect(runbook).toContain(`\`${config.name}\``)
	})

	it('names every Custom Domain from wrangler.jsonc', () => {
		const domains = custom_domains(config)

		expect(domains).not.toHaveLength(0)
		for (const domain of domains) expect(runbook).toContain(`\`${domain}\``)
	})

	it('quotes the pnpm onFail policy from package.json', () => {
		const package_json = JSON.parse(readFileSync('package.json', ENCODING)) as PackageJson
		const quoted = quoted_on_fail(runbook)

		expect(quoted).not.toHaveLength(0)
		for (const value of quoted) expect(value).toBe(package_json.devEngines.packageManager.onFail)
	})

	it('links the build authentication explanation instead of copying it', () => {
		expect(runbook).toContain(AUTH_LINK)
		expect(runbook).not.toContain('NODE_AUTH_TOKEN=')
	})

	it.each(['README.md', 'docs/overview.md'])('is linked from %s', (file) => {
		expect(readFileSync(file, ENCODING)).toContain(RUNBOOK_LINK)
	})
})
