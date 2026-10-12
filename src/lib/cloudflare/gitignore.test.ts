import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cloudflare_gitignore } from './gitignore.js'
import { cloudflare_init } from './init.js'
import { sync_fixture } from './sync-fixture.js'
import { cloudflare_sync } from './sync.js'

const { ENCODING, SOURCE_DIR } = sync_fixture
const { GITIGNORE_FILE, GENERATED_ENTRIES } = cloudflare_gitignore

const WORKER_TYPES_ENTRY = '/worker-configuration.d.ts'
// What `sv create` writes before any repository exists — none of app-kit's generated files.
const SCAFFOLD_CONTENT = 'node_modules\n\n# Output\n.wrangler\n/.svelte-kit\n'

function gitignore_path(): string {
	return path.join(sync_fixture.directory(), GITIGNORE_FILE)
}

function read_gitignore(): string {
	return readFileSync(gitignore_path(), ENCODING)
}

function lines_of(content: string): Array<string> {
	return content.split('\n')
}

describe('ensure_entries', () => {
	it('appends the generated worker types file to a scaffold that lacks it', () => {
		const patched = cloudflare_gitignore.ensure_entries(SCAFFOLD_CONTENT)

		expect(patched).toBe(`${SCAFFOLD_CONTENT}${WORKER_TYPES_ENTRY}\n`)
	})

	it('is a no-op once the entry is present', () => {
		const patched = cloudflare_gitignore.ensure_entries(SCAFFOLD_CONTENT)

		expect(cloudflare_gitignore.ensure_entries(patched)).toBe(patched)
	})

	it('starts the entry on its own line when the file has no trailing newline', () => {
		const patched = cloudflare_gitignore.ensure_entries('node_modules')

		expect(patched).toBe(`node_modules\n${WORKER_TYPES_ENTRY}\n`)
	})

	it('does not count a longer pattern that merely contains the entry', () => {
		const patched = cloudflare_gitignore.ensure_entries(`!${WORKER_TYPES_ENTRY}.bak\n`)

		expect(lines_of(patched)).toContain(WORKER_TYPES_ENTRY)
	})

	it('recognizes an entry written with CRLF line endings', () => {
		const content = `node_modules\r\n${WORKER_TYPES_ENTRY}\r\n`

		expect(cloudflare_gitignore.ensure_entries(content)).toBe(content)
	})
})

describe('overlay .gitignore', () => {
	beforeEach(() => {
		sync_fixture.create()
	})

	afterEach(() => {
		sync_fixture.remove()
	})

	// #290: kit writes `.gitignore` only into a git repository, so a project initialized before
	// `git init` reaches the overlay with whatever its scaffold wrote — or with no file at all.
	it('creates the file with every generated entry when the project has none', () => {
		expect(existsSync(gitignore_path())).toBe(false)

		const changes = cloudflare_sync.apply_overlay(sync_fixture.directory(), SOURCE_DIR)

		expect(changes).toContainEqual({ file: GITIGNORE_FILE, action: 'created' })
		expect(lines_of(read_gitignore())).toEqual(expect.arrayContaining([...GENERATED_ENTRIES]))
	})

	it('adds the entries to an existing file and keeps the lines already there', () => {
		writeFileSync(gitignore_path(), SCAFFOLD_CONTENT)

		const changes = cloudflare_sync.apply_overlay(sync_fixture.directory(), SOURCE_DIR)

		expect(changes).toContainEqual({ file: GITIGNORE_FILE, action: 'updated' })
		expect(read_gitignore().startsWith(SCAFFOLD_CONTENT)).toBe(true)
		expect(lines_of(read_gitignore())).toContain(WORKER_TYPES_ENTRY)
	})

	it('changes nothing on a second run', () => {
		cloudflare_sync.apply_overlay(sync_fixture.directory(), SOURCE_DIR)
		const after_first = read_gitignore()

		const changes = cloudflare_sync.apply_overlay(sync_fixture.directory(), SOURCE_DIR)

		expect(changes).toContainEqual({ file: GITIGNORE_FILE, action: 'skipped' })
		expect(read_gitignore()).toBe(after_first)
	})

	it('ignores the generated worker types file after josh-app init', () => {
		cloudflare_init.run_init(sync_fixture.directory(), SOURCE_DIR)

		expect(lines_of(read_gitignore())).toContain(WORKER_TYPES_ENTRY)
	})
})

// app-kit runs the same managed scripts it distributes, so it generates the same files: an entry a
// consumer needs and this repository lacks would fail app-kit's own gate first.
describe('app-kit own .gitignore', () => {
	it('carries every entry the overlay distributes', () => {
		const own_lines = lines_of(readFileSync(GITIGNORE_FILE, ENCODING))

		expect(own_lines).toEqual(expect.arrayContaining([...GENERATED_ENTRIES]))
	})
})
