import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const WORKFLOW = readFileSync('.github/workflows/ci.yml', 'utf8')
const RESOLVE_STEPS = [
	...WORKFLOW.matchAll(
		/ {6}- name: Resolve pnpm version\n {8}id: pnpm-version\n {8}run: \|\n((?: {10}.*\n)+)/gu,
	),
]
const SETUP_STEPS = [
	...WORKFLOW.matchAll(
		/ {6}- name: Setup pnpm\n {8}uses: pnpm\/setup@[a-f0-9]{40}.*\n {8}with:\n {10}version: \$\{\{ steps\.pnpm-version\.outputs\.version \}\}\n {10}install: false/gu,
	),
]
const SCRIPTS = RESOLVE_STEPS.map((match) => match[1]?.replaceAll(/^ {10}/gmu, '') ?? '')
const PINNED_VERSION = '11.27.1'
const FALLBACK_VERSION = '11.28.0'

describe('CI pnpm setup', () => {
	it('uses the same version resolver in both CI jobs', () => {
		expect(SCRIPTS).toHaveLength(2)
		expect(SCRIPTS[0]).toBe(SCRIPTS[1])
		expect(SETUP_STEPS).toHaveLength(2)
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
