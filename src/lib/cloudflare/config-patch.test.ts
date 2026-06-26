import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { config_merge } from '@joshuafolkken/kit/config-merge'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { config_patch } from './config-patch.js'

const ENCODING = 'utf8'
const CSPELL_FILE = 'cspell.config.yaml'
const TSCONFIG_FILE = 'tsconfig.json'

const KIT_CSPELL = '@joshuafolkken/kit/cspell/sveltekit'
const KIT_CSPELL_BASE = '@joshuafolkken/kit/cspell'
const APP_KIT_CSPELL = '@joshuafolkken/app-kit/cspell/sveltekit'
const KIT_TSCONFIG = '@joshuafolkken/kit/tsconfig/sveltekit.jsonc'
const APP_KIT_TSCONFIG = '@joshuafolkken/app-kit/tsconfig/sveltekit.jsonc'
const CONSUMER_WORD = 'middleware'
const CONSUMER_EXCLUDE = 'src/demo/**'

// A consumer cspell.config.yaml carrying both kit's base import and kit's sveltekit import, a
// custom word, and an empty ignorePaths — the state `josh sync` leaves behind.
const CSPELL_WITH_KIT = `version: '0.2'
import:
  - '${KIT_CSPELL_BASE}'
  - '${KIT_CSPELL}'
words:
  - ${CONSUMER_WORD}
ignorePaths: []
`

// A consumer tsconfig.json extending kit's sveltekit preset plus the generated SvelteKit config,
// with a consumer exclude — the state `josh sync` leaves behind.
const TSCONFIG_WITH_KIT = `{
	"extends": ["./node_modules/${KIT_TSCONFIG}", "./.svelte-kit/tsconfig.json"],
	"compilerOptions": { "module": "NodeNext" },
	"exclude": ["${CONSUMER_EXCLUDE}"]
}
`

const state = { directory: '' }

function fixture_path(relative_path: string): string {
	return path.join(state.directory, relative_path)
}

function read_fixture(relative_path: string): string {
	return readFileSync(fixture_path(relative_path), ENCODING)
}

beforeEach(() => {
	state.directory = mkdtempSync(path.join(tmpdir(), 'app-kit-patch-'))
})

afterEach(() => {
	rmSync(state.directory, { recursive: true, force: true })
})

describe('config patch — cspell.config.yaml', () => {
	it('replaces the kit sveltekit import with app-kit and preserves the base + words', () => {
		const patched = config_patch.patch_cspell_content(CSPELL_WITH_KIT)

		expect(patched).toContain(APP_KIT_CSPELL)
		expect(patched).not.toContain(KIT_CSPELL)
		expect(patched).toContain(KIT_CSPELL_BASE)
		expect(patched).toContain(CONSUMER_WORD)
	})

	it('ensures the app-kit import when no kit sveltekit line is present', () => {
		const without_kit = `version: '0.2'\nimport:\n  - '${KIT_CSPELL_BASE}'\n`

		expect(config_patch.patch_cspell_content(without_kit)).toContain(APP_KIT_CSPELL)
	})

	it('removes only the exact sveltekit segment, not a sveltekit-prefixed sibling', () => {
		const sibling = `${KIT_CSPELL}-extra`
		const with_sibling = `version: '0.2'\nimport:\n  - '${KIT_CSPELL}'\n  - '${sibling}'\n`

		const imports = config_merge.read_yaml_list_field(
			config_patch.patch_cspell_content(with_sibling),
			'import',
		)

		expect(imports).toContain(sibling)
		expect(imports).not.toContain(KIT_CSPELL)
	})

	it('ensures the SvelteKit + Cloudflare ignorePaths', () => {
		const patched = config_patch.patch_cspell_content(CSPELL_WITH_KIT)

		expect(patched).toContain('.svelte-kit/**')
		expect(patched).toContain('.wrangler/**')
	})

	it('is idempotent — a second cspell pass returns identical content', () => {
		const once = config_patch.patch_cspell_content(CSPELL_WITH_KIT)

		expect(config_patch.patch_cspell_content(once)).toBe(once)
	})
})

describe('config patch — tsconfig.json', () => {
	it('replaces the kit sveltekit extends with app-kit and preserves the rest', () => {
		const patched = config_patch.patch_tsconfig_content(TSCONFIG_WITH_KIT)

		expect(patched).toContain(APP_KIT_TSCONFIG)
		expect(patched).not.toContain(KIT_TSCONFIG)
		expect(patched).toContain('./.svelte-kit/tsconfig.json')
		expect(patched).toContain(CONSUMER_EXCLUDE)
	})

	it('is idempotent — a second tsconfig pass returns identical content', () => {
		const once = config_patch.patch_tsconfig_content(TSCONFIG_WITH_KIT)

		expect(config_patch.patch_tsconfig_content(once)).toBe(once)
	})
})

describe('config patch — patch_configs file handling', () => {
	it('updates existing config files and reports the change', () => {
		writeFileSync(fixture_path(CSPELL_FILE), CSPELL_WITH_KIT)
		writeFileSync(fixture_path(TSCONFIG_FILE), TSCONFIG_WITH_KIT)

		const changes = config_patch.patch_configs(state.directory)

		expect(changes.find((change) => change.file === CSPELL_FILE)?.action).toBe('updated')
		expect(changes.find((change) => change.file === TSCONFIG_FILE)?.action).toBe('updated')
		expect(read_fixture(CSPELL_FILE)).toContain(APP_KIT_CSPELL)
		expect(read_fixture(TSCONFIG_FILE)).toContain(APP_KIT_TSCONFIG)
	})

	it('skips absent config files — the orchestrated base seeds them first', () => {
		const changes = config_patch.patch_configs(state.directory)

		expect(changes.every((change) => change.action === 'skipped')).toBe(true)
	})

	it('re-running on already-correct files is a byte-identical no-op', () => {
		writeFileSync(fixture_path(CSPELL_FILE), CSPELL_WITH_KIT)
		writeFileSync(fixture_path(TSCONFIG_FILE), TSCONFIG_WITH_KIT)
		config_patch.patch_configs(state.directory)
		const after_first = read_fixture(CSPELL_FILE)

		const changes = config_patch.patch_configs(state.directory)

		expect(changes.every((change) => change.action === 'skipped')).toBe(true)
		expect(read_fixture(CSPELL_FILE)).toBe(after_first)
	})
})
