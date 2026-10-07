import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const WORKFLOW = '.github/workflows/publish.yml'
const GITHUB_JOB = 'publish-github'
const NPM_JOB = 'publish-npm'
const GITHUB_REGISTRY = 'https://npm.pkg.github.com'
const NPM_REGISTRY = 'https://registry.npmjs.org'
const RELEASE_TAG_REF = 'ref: ${{ github.event.client_payload.tag }}'
// A job header is a two-space-indented key under `jobs:`; its body is every deeper-indented line.
const JOB_RE = /^ {2}(?<name>[\w-]+):\n(?<body>(?:(?: {4}.*)?\n)+)/gmu

function read_jobs(): Map<string, string> {
	const [, jobs_section = ''] = readFileSync(WORKFLOW, 'utf8').split(/^jobs:\n/mu, 2)
	const jobs = [...jobs_section.matchAll(JOB_RE)].map((match): [string, string] => [
		match.groups?.['name'] ?? '',
		match.groups?.['body'] ?? '',
	])

	return new Map(jobs)
}

function job(name: string): string {
	return read_jobs().get(name) ?? ''
}

// #226: the same release is published to GitHub Packages (existing consumers) and public npm (new
// consumers, no auth). Each registry is its own job so one failing never skips the other.
describe('publish workflow', () => {
	it('publishes to the two registries in exactly two jobs', () => {
		expect([...read_jobs().keys()]).toStrictEqual([GITHUB_JOB, NPM_JOB])
	})

	it.each([GITHUB_JOB, NPM_JOB])('runs %s without depending on another job', (name) => {
		expect(job(name)).not.toMatch(/^ {4}needs:/mu)
	})

	it.each([GITHUB_JOB, NPM_JOB])('checks out the release tag in %s', (name) => {
		expect(job(name)).toContain(RELEASE_TAG_REF)
	})

	it('publishes to GitHub Packages with the package write permission', () => {
		const body = job(GITHUB_JOB)

		expect(body).toContain('packages: write')
		expect(body).toContain(
			`pnpm publish --no-git-checks --tag latest --registry ${GITHUB_REGISTRY}`,
		)
	})

	it('publishes to npm with OIDC and without any user config scope mapping', () => {
		const body = job(NPM_JOB)

		expect(body).toContain('id-token: write')
		expect(body).toMatch(
			new RegExp(
				String.raw`npm publish \S+\.tgz --access public .*--registry ${NPM_REGISTRY} --userconfig /dev/null`,
				'u',
			),
		)
	})

	it('never hands the npm job a long-lived npm token', () => {
		expect(job(NPM_JOB)).not.toMatch(/NPM_TOKEN/u)
	})
})

// #265: kit's distributed github-release.yml waits for the run titled `Publish <tag>` of
// publish.yml before creating the release (joshuafolkken/kit#3138), so the title is a contract.
describe('publish workflow release hand-off', () => {
	it('starts on the tag announcement and titles each run Publish <tag>', () => {
		const source = readFileSync(WORKFLOW, 'utf8')

		expect(source).toMatch(/^run-name: Publish \$\{\{ github\.event\.client_payload\.tag \}\}$/mu)
		expect(source).toMatch(/repository_dispatch:\n\s+types: \[new-tag-created\]/u)
	})
})
