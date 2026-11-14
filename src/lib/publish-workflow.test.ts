import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { process_runner } from './process/runner.js'

const WORKFLOW = '.github/workflows/publish.yml'
const GITHUB_JOB = 'publish-github'
const NPM_JOB = 'publish-npm'
const GITHUB_REGISTRY = 'https://npm.pkg.github.com'
const NPM_REGISTRY = 'https://registry.npmjs.org'
const PUBLISH_TIMEOUT = 30_000
const ARTIFACT_NAME = 'name: npm-package'
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

function prepare_publish_fixture(directory: string, name: string): void {
	const repository = path.join(directory, 'repository')
	const registry = /registry-url: '(?<registry>[^']+)'/u.exec(job(name))?.groups?.['registry']

	mkdirSync(repository)
	writeFileSync(
		path.join(repository, 'package.json'),
		JSON.stringify({ name: '@joshuafolkken/publish-fixture', version: '1.0.0' }),
	)
	expect(registry).toBeDefined()
	// The repository maps the scope to the other registry, so each job has a config to override.
	const conflicting = registry === NPM_REGISTRY ? GITHUB_REGISTRY : NPM_REGISTRY

	writeFileSync(path.join(repository, '.npmrc'), `@joshuafolkken:registry=${conflicting}\n`)
	expect(
		process_runner.run_command(
			'npm',
			['pack', '--ignore-scripts', '--pack-destination', directory],
			repository,
		).status,
	).toBe(0)
	writeFileSync(path.join(directory, '.npmrc'), `@joshuafolkken:registry=${registry}\n`)
}

function dry_run_publish(name: string, directory: string): ReturnType<typeof spawnSync> {
	const command = /^ {8}run: (?<command>cd .*npm publish .+)$/mu.exec(job(name))?.groups?.[
		'command'
	]

	expect(command).toBeDefined()

	return spawnSync('/bin/bash', ['-e', '-c', `${command} --dry-run --ignore-scripts`], {
		encoding: 'utf8',
		timeout: PUBLISH_TIMEOUT,
		cwd: path.join(directory, 'repository'),
		env: {
			...process.env,
			RUNNER_TEMP: directory,
			TARBALL: 'joshuafolkken-publish-fixture-1.0.0.tgz',
			PUBLISH_TAG: 'latest',
			NPM_CONFIG_USERCONFIG: path.join(directory, '.npmrc'),
		},
	})
}

// #226: the same release is published to GitHub Packages (existing consumers) and public npm (new
// consumers, no auth). Each registry is its own job so one failing never skips the other.
describe('publish workflow', () => {
	it('packs once before publishing the same artifact to both registries', () => {
		expect(job('pack')).toContain('pnpm pack --out "$RUNNER_TEMP/$TARBALL"')
		expect(job('pack')).toContain(ARTIFACT_NAME)
		expect(job('pack')).not.toMatch(/(?:packages|id-token): write/u)
	})

	it.each([GITHUB_JOB, NPM_JOB])(
		'runs %s after packing, independently of the other registry',
		(name) => {
			expect(job(name)).toMatch(/^ {4}needs: pack$/mu)
			expect(job(name)).toContain(ARTIFACT_NAME)
			expect(job(name)).toContain('TARBALL: ${{ needs.pack.outputs.tarball }}')
			expect(job(name)).not.toMatch(/(?:pnpm install|pnpm pack|pnpm run)/u)
		},
	)

	it.each(['pack', GITHUB_JOB, NPM_JOB])(
		'runs %s only on a release tag without overriding its checkout',
		(name) => {
			expect(job(name)).toContain("if: startsWith(github.ref, 'refs/tags/v')")
			expect(job(name)).not.toMatch(/^ +ref:/mu)
		},
	)
})

describe('publish permissions', () => {
	it('publishes to GitHub Packages with the package write permission', () => {
		const body = job(GITHUB_JOB)

		expect(body).toContain('packages: write')
		expect(body).toContain(
			`npm publish "$TARBALL" --tag "$PUBLISH_TAG" --registry ${GITHUB_REGISTRY}`,
		)
	})

	it('publishes to npm with OIDC and without any user config scope mapping', () => {
		const body = job(NPM_JOB)

		expect(body).toContain('id-token: write')
		expect(body).toContain(
			`npm publish "$TARBALL" --access public --tag "$PUBLISH_TAG" --registry ${NPM_REGISTRY} --userconfig /dev/null`,
		)
	})

	it('never hands the npm job a long-lived npm token', () => {
		expect(job(NPM_JOB)).not.toMatch(/NPM_TOKEN/u)
	})
})

describe('publish registry resolution', () => {
	it.each([
		[GITHUB_JOB, GITHUB_REGISTRY],
		[NPM_JOB, NPM_REGISTRY],
	])(
		'routes %s to its registry despite conflicting scope configuration',
		(name, registry) => {
			const directory = mkdtempSync(path.join(tmpdir(), 'app-kit-publish-'))

			try {
				prepare_publish_fixture(directory, name)
				const result = dry_run_publish(name, directory)

				expect(result.error).toBeUndefined()
				expect(result.status).toBe(0)
				expect(`${String(result.stdout)}${String(result.stderr)}`).toContain(
					`Publishing to ${registry}`,
				)
			} finally {
				rmSync(directory, { recursive: true, force: true })
			}
		},
		PUBLISH_TIMEOUT,
	)
})

// #265: kit's distributed github-release.yml waits for the run titled `Publish <tag>` of
// publish.yml before creating the release (joshuafolkken/kit#3138), so the title is a contract.
describe('publish workflow release hand-off', () => {
	it('dispatches on the release tag and titles each run Publish <tag>', () => {
		const source = readFileSync(WORKFLOW, 'utf8')

		expect(source).toMatch(/^run-name: Publish \$\{\{ github\.ref_name \}\}$/mu)
		expect(source).toMatch(/^ {2}workflow_dispatch:$/mu)
		expect(readFileSync('.github/workflows/auto-tag.yml', 'utf8')).toContain(
			'gh workflow run publish.yml --ref "$TAG"',
		)
	})
})
