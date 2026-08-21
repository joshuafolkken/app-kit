import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { port_seed_fixture } from './port-seed-fixture.js'
import { preview_port } from './preview-port.js'

const { PORT_SEED_KEY, BASE_PREVIEW_PORT, TEST_SEED, SEEDED_PREVIEW_PORT } = port_seed_fixture
const seed = port_seed_fixture.isolate()

// A directory that is never created: the "no .env anywhere" case has to be a path the loader
// cannot find a file at, and creating one would defeat the point.
const MISSING_DIRECTORY = '/fixture/no-such-project'

const directories: Array<string> = []

// `josh-app` runs from the project root, so a fixture directory stands in for a consumer's tree.
function make_project(contents?: string): string {
	const directory = mkdtempSync(path.join(tmpdir(), 'app-kit-port-'))

	directories.push(directory)
	if (contents !== undefined) writeFileSync(path.join(directory, '.env'), contents)

	return directory
}

// The loader writes into process.env and never overrides a variable already there, so a seed left
// behind by one test would silently pin every later one. Cleared before each and restored after.
beforeEach(seed.clear)

afterEach(() => {
	seed.restore()

	for (const directory of directories) {
		rmSync(directory, { recursive: true, force: true })
	}

	directories.length = 0
})

describe('preview port resolution', () => {
	it('is the historical 4173 when no seed is set, so CI and un-migrated projects are untouched', () => {
		expect(preview_port.resolve(MISSING_DIRECTORY)).toBe(BASE_PREVIEW_PORT)
	})

	it('treats a project whose .env omits the seed as unseeded', () => {
		expect(preview_port.resolve(make_project('OTHER=value\n'))).toBe(BASE_PREVIEW_PORT)
	})

	// The regression app-kit#177 exists for: `josh-app` is a bundled binary with no
	// `--env-file-if-exists=.env` on its path, so without an explicit load `PORT_SEED` never reaches
	// process.env and the scan waits on 4173 while `pnpm josh port preview` starts wrangler on 4174.
	it('reads the seed from the project .env, which josh-app is not otherwise given', () => {
		const project = make_project(`${PORT_SEED_KEY}=${String(TEST_SEED)}\n`)

		expect(preview_port.resolve(project)).toBe(SEEDED_PREVIEW_PORT)
	})

	// Matches the `--env-file` semantics the loader stands in for: `PORT_SEED=2 josh-app dast` must
	// still override the file.
	it('lets a seed already in the environment win over the file', () => {
		const project = make_project(`${PORT_SEED_KEY}=9\n`)

		seed.set(TEST_SEED)

		expect(preview_port.resolve(project)).toBe(SEEDED_PREVIEW_PORT)
	})

	// A malformed seed must not fall back to the default: that would put two projects back on one
	// port, which is the collision the seed exists to remove.
	it('throws on a malformed seed instead of silently serving the default port', () => {
		const project = make_project(`${PORT_SEED_KEY}=not-a-number\n`)

		expect(() => preview_port.resolve(project)).toThrow(/PORT_SEED/u)
	})
})
