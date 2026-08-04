import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { config_merge } from '@joshuafolkken/kit/config-merge'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { config_patch } from './config-patch.js'

const ENCODING = 'utf8'
const CSPELL_FILE = 'cspell.config.yaml'

const KIT_CSPELL = '@joshuafolkken/kit/cspell/sveltekit'
const KIT_CSPELL_BASE = '@joshuafolkken/kit/cspell'
const APP_KIT_CSPELL = '@joshuafolkken/app-kit/cspell/sveltekit'
const CONSUMER_WORD = 'middleware'

const IMPORT_FIELD = 'import'
const IGNORE_FIELD = 'ignorePaths'
const SVELTE_KIT_GLOB = '.svelte-kit/**'
const WRANGLER_GLOB = '.wrangler/**'
const CONSUMER_IGNORE = 'coverage/**'

// The real app-kit cspell preset and the cspell binary, resolved from the repo root (vitest cwd).
const PRESET_PATH = path.join(process.cwd(), 'cspell', 'sveltekit.yaml')
const CSPELL_BIN = path.join(process.cwd(), 'node_modules', '.bin', 'cspell')
// Generated dirs the preset must ignore through the import, plus a control file that must stay
// flagged, proving cspell actually ran and the misspelling is otherwise detected.
const GENERATED_DIRS: ReadonlyArray<string> = ['.svelte-kit', '.fast-check', '.wrangler']
const CONTROL_FILE = 'control.txt'
// cspell:ignore zzqwxmisspelledtoken -- intentional gibberish that must trip cspell in the probe
const MISSPELLED_TOKEN = 'zzqwxmisspelledtoken'

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

// A consumer cspell.config.yaml an earlier sync already migrated to the app-kit import but that
// still carries the redundant cloned ignorePaths plus the consumer's own entry.
const CSPELL_WITH_REDUNDANT_IGNORES = `version: '0.2'
import:
  - '${KIT_CSPELL_BASE}'
  - '${APP_KIT_CSPELL}'
ignorePaths:
  - '${SVELTE_KIT_GLOB}'
  - '${WRANGLER_GLOB}'
  - '${CONSUMER_IGNORE}'
`

const state = { directory: '' }

function fixture_path(relative_path: string): string {
	return path.join(state.directory, relative_path)
}

function read_imports(content: string): ReadonlyArray<string> {
	return config_merge.read_yaml_list_field(content, IMPORT_FIELD)
}

// Seed a consumer whose cspell.config.yaml only imports the real app-kit preset (empty local
// ignorePaths) and drop a misspelled file into every generated dir plus a control file at the root.
function seed_import_only_consumer(): void {
	const config = `version: '0.2'\nimport:\n  - '${PRESET_PATH}'\nwords: []\nignorePaths: []\n`

	writeFileSync(fixture_path(CSPELL_FILE), config)
	writeFileSync(fixture_path(CONTROL_FILE), `${MISSPELLED_TOKEN}\n`)

	for (const generated_directory of GENERATED_DIRS) {
		mkdirSync(fixture_path(generated_directory), { recursive: true })
		writeFileSync(fixture_path(path.join(generated_directory, 'gen.txt')), `${MISSPELLED_TOKEN}\n`)
	}
}

// Run cspell over the fixture and return its combined output (cspell exits non-zero when it finds
// issues, so the issue listing arrives via the thrown error's stdout).
function run_cspell_report(): string {
	const args = ['lint', '--no-progress', '--dot', '--config', fixture_path(CSPELL_FILE), '**/*.txt']

	try {
		return execFileSync(CSPELL_BIN, args, { cwd: state.directory, encoding: ENCODING })
	} catch (error) {
		const result = error as { stdout?: string; stderr?: string }

		return `${result.stdout ?? ''}${result.stderr ?? ''}`
	}
}

beforeEach(() => {
	state.directory = mkdtempSync(path.join(tmpdir(), 'app-kit-patch-cspell-'))
})

afterEach(() => {
	rmSync(state.directory, { recursive: true, force: true })
})

describe('config patch — cspell.config.yaml', () => {
	it('replaces the kit imports with app-kit, strips the redundant base, and preserves words', () => {
		const patched = config_patch.patch_cspell_content(CSPELL_WITH_KIT)
		const imports = read_imports(patched)

		expect(imports).toContain(APP_KIT_CSPELL)
		expect(imports).not.toContain(KIT_CSPELL)
		// kit#601: the app-kit preset re-exports the base, so the bare base line is now stripped
		expect(imports).not.toContain(KIT_CSPELL_BASE)
		expect(patched).toContain(CONSUMER_WORD)
	})

	it('ensures the app-kit import when no kit sveltekit line is present', () => {
		const without_kit = `version: '0.2'\nimport:\n  - '${KIT_CSPELL_BASE}'\n`

		expect(config_patch.patch_cspell_content(without_kit)).toContain(APP_KIT_CSPELL)
	})

	it('removes only the exact sveltekit segment, not a sveltekit-prefixed sibling', () => {
		const sibling = `${KIT_CSPELL}-extra`
		const with_sibling = `version: '0.2'\nimport:\n  - '${KIT_CSPELL}'\n  - '${sibling}'\n`

		const imports = read_imports(config_patch.patch_cspell_content(with_sibling))

		expect(imports).toContain(sibling)
		expect(imports).not.toContain(KIT_CSPELL)
	})

	it('is idempotent — a second cspell pass returns identical content', () => {
		const once = config_patch.patch_cspell_content(CSPELL_WITH_KIT)

		expect(config_patch.patch_cspell_content(once)).toBe(once)
	})
})

describe('config patch — cspell base import dedup', () => {
	it('strips the redundant kit base import when the app-kit preset is already present', () => {
		const with_base = `version: '0.2'\nimport:\n  - '${KIT_CSPELL_BASE}'\n  - '${APP_KIT_CSPELL}'\n`

		const imports = read_imports(config_patch.patch_cspell_content(with_base))

		expect(imports).toStrictEqual([APP_KIT_CSPELL])
	})

	it('strips the base but leaves a kit cspell-prefixed sibling untouched', () => {
		const sibling = '@joshuafolkken/kit/cspell-extra'
		const with_sibling = `version: '0.2'\nimport:\n  - '${KIT_CSPELL_BASE}'\n  - '${sibling}'\n  - '${APP_KIT_CSPELL}'\n`

		const imports = read_imports(config_patch.patch_cspell_content(with_sibling))

		expect(imports).toContain(sibling)
		expect(imports).not.toContain(KIT_CSPELL_BASE)
	})

	it('converges after stripping the base — a second pass is identical', () => {
		const once = config_patch.patch_cspell_content(
			`version: '0.2'\nimport:\n  - '${KIT_CSPELL_BASE}'\n  - '${APP_KIT_CSPELL}'\n`,
		)

		expect(config_patch.patch_cspell_content(once)).toBe(once)
	})
})

describe('config patch — cspell ignorePaths single-sourcing', () => {
	it('does not clone ignorePaths locally — the preset import single-sources them', () => {
		const ignore_paths = config_merge.read_yaml_list_field(
			config_patch.patch_cspell_content(CSPELL_WITH_KIT),
			IGNORE_FIELD,
		)

		expect(ignore_paths).not.toContain(SVELTE_KIT_GLOB)
		expect(ignore_paths).not.toContain(WRANGLER_GLOB)
	})

	it('strips redundant cloned ignorePaths from a prior sync, keeping the consumer entry', () => {
		const ignore_paths = config_merge.read_yaml_list_field(
			config_patch.patch_cspell_content(CSPELL_WITH_REDUNDANT_IGNORES),
			IGNORE_FIELD,
		)

		expect(ignore_paths).toStrictEqual([CONSUMER_IGNORE])
	})

	it('converges after stripping redundant ignorePaths — a second pass is identical', () => {
		const once = config_patch.patch_cspell_content(CSPELL_WITH_REDUNDANT_IGNORES)

		expect(config_patch.patch_cspell_content(once)).toBe(once)
	})
})

describe('config patch — cspell preset import propagation', () => {
	it('ignores generated dirs through the import alone, still flagging the control file', () => {
		seed_import_only_consumer()

		const report = run_cspell_report()

		expect(report).toContain(CONTROL_FILE)

		for (const generated_directory of GENERATED_DIRS) {
			expect(report).not.toContain(generated_directory)
		}
	})
})
