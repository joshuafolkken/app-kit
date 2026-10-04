import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// A patch applies to one exact version; a dependency update that moves the package off it leaves
// the patch unused and fails with ERR_PNPM_UNUSED_PATCH (#247). `josh latest` skips overridden
// packages, so every patched package is held by an override pinned to the patched version.
const WORKSPACE = readFileSync('pnpm-workspace.yaml', 'utf8')
const PATCH_KEY_RE = /^(?<name>@?[^@]+)@(?<version>[^@]+)$/u
const ENTRY_RE = /^ {2}'?(?<key>[^':]+)'?: (?<value>\S+)/u

function read_section(name: string): Map<string, string> {
	const block = new RegExp(String.raw`^${name}:\n((?: {2}.*\n)+)`, 'mu').exec(WORKSPACE)?.[1] ?? ''
	const entries = block.split('\n').map((line) => ENTRY_RE.exec(line)?.groups)

	return new Map(
		entries.flatMap((groups) => (groups ? [[groups['key'] ?? '', groups['value'] ?? '']] : [])),
	)
}

const overrides = read_section('overrides')
const patched_versions = [...read_section('patchedDependencies').keys()].map(
	(key) => PATCH_KEY_RE.exec(key)?.groups,
)

describe('patched dependencies', () => {
	it('has at least one patched package to hold', () => {
		expect(patched_versions.length).toBeGreaterThan(0)
	})

	it.each(patched_versions)('pins %o to the patched version through overrides', (groups) => {
		expect(groups).toBeDefined()
		expect(overrides.get(groups?.['name'] ?? '')).toBe(groups?.['version'])
	})

	it('holds SvelteKit on the major the patched adapter supports', () => {
		expect(overrides.get('@sveltejs/kit')).toMatch(/^\^2\./u)
	})
})
