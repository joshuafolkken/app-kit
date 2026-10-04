import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const WORKFLOW = readFileSync('.github/workflows/ci.yml', 'utf8')
// kit's shared action that every ci.yml job prepares pnpm through (joshuafolkken/kit#3095).
const ACTION = readFileSync('.github/actions/setup-pnpm/action.yml', 'utf8')
const CI_JOBS_USING_ACTION = 2
const ACTION_STEPS = [...WORKFLOW.matchAll(/ {8}uses: \.\/\.github\/actions\/setup-pnpm\n/gu)]
const RESOLVE_STEPS = [
	...ACTION.matchAll(
		/ {4}- name: Resolve pnpm version\n {6}id: pnpm-version\n {6}shell: bash\n {6}run: \|\n((?: {8}.*\n)+)/gu,
	),
]
const SETUP_STEPS = [
	...ACTION.matchAll(
		/ {4}- name: Setup pnpm\n {6}uses: pnpm\/setup@[a-f0-9]{40}.*\n {6}with:\n {8}version: \$\{\{ steps\.pnpm-version\.outputs\.version \}\}\n/gu,
	),
]
const SCRIPTS = RESOLVE_STEPS.map((match) => match[1]?.replaceAll(/^ {8}/gmu, '') ?? '')
const PINNED_VERSION = '11.27.1'
const FALLBACK_VERSION = '11.28.0'

describe('CI pnpm setup', () => {
	it('prepares pnpm in both CI jobs through the one version resolver', () => {
		expect(ACTION_STEPS).toHaveLength(CI_JOBS_USING_ACTION)
		expect(SCRIPTS).toHaveLength(1)
		expect(SETUP_STEPS).toHaveLength(1)
	})

	it.each([
		[{ packageManager: `pnpm@${PINNED_VERSION}+sha512.test` }, PINNED_VERSION],
		[
			{
				devEngines: {
					packageManager: { name: 'pnpm', version: `${FALLBACK_VERSION}+sha512.test` },
				},
			},
			FALLBACK_VERSION,
		],
		[{}, 'latest'],
	])('resolves the pnpm version from the manifest', (manifest, expected_version) => {
		const directory = mkdtempSync(path.join(tmpdir(), 'app-kit-ci-pnpm-'))
		const output = path.join(directory, 'github-output')

		try {
			writeFileSync(path.join(directory, 'package.json'), JSON.stringify(manifest))
			execFileSync('/bin/bash', ['-e', '-c', SCRIPTS[0] ?? ''], {
				cwd: directory,
				env: { ...process.env, GITHUB_OUTPUT: output },
			})
			expect(readFileSync(output, 'utf8')).toBe(`version=${expected_version}\n`)
		} finally {
			rmSync(directory, { recursive: true, force: true })
		}
	})
})
