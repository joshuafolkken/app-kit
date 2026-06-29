import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { config_merge } from '@joshuafolkken/kit/config-merge'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { config_patch } from './config-patch.js'

const ENCODING = 'utf8'
const CSPELL_FILE = 'cspell.config.yaml'
const TSCONFIG_FILE = 'tsconfig.json'
const LEFTHOOK_FILE = 'lefthook.yml'

const KIT_CSPELL = '@joshuafolkken/kit/cspell/sveltekit'
const KIT_CSPELL_BASE = '@joshuafolkken/kit/cspell'
const APP_KIT_CSPELL = '@joshuafolkken/app-kit/cspell/sveltekit'
const KIT_TSCONFIG = '@joshuafolkken/kit/tsconfig/sveltekit.jsonc'
const APP_KIT_TSCONFIG = '@joshuafolkken/app-kit/tsconfig/sveltekit.jsonc'
const KIT_LEFTHOOK = 'node_modules/@joshuafolkken/kit/lefthook/sveltekit.yml'
const APP_KIT_LEFTHOOK = 'node_modules/@joshuafolkken/app-kit/lefthook/sveltekit.yml'
const CONSUMER_LEFTHOOK_EXTEND = 'lefthook/local.yml'
const CONSUMER_LEFTHOOK_COMMAND = 'consumer-hook'
const EXTENDS_FIELD = 'extends'
const CONSUMER_WORD = 'middleware'
const CONSUMER_EXCLUDE = 'src/demo/**'

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

// A consumer tsconfig.json extending kit's sveltekit preset plus the generated SvelteKit config,
// with a consumer exclude — the state `josh sync` leaves behind.
const TSCONFIG_WITH_KIT = `{
	"extends": ["./node_modules/${KIT_TSCONFIG}", "./.svelte-kit/tsconfig.json"],
	"compilerOptions": { "module": "NodeNext" },
	"exclude": ["${CONSUMER_EXCLUDE}"]
}
`

// A consumer lefthook.yml extending kit's sveltekit preset plus a consumer-local extends and a
// consumer-owned hook block — the multi-key state `josh sync` leaves behind before the
// kit→app-kit migration. The block proves the patch touches only the `extends` list.
const LEFTHOOK_WITH_KIT = `extends:
  - ${KIT_LEFTHOOK}
  - ${CONSUMER_LEFTHOOK_EXTEND}
pre-commit:
  commands:
    ${CONSUMER_LEFTHOOK_COMMAND}:
      run: echo consumer
`

const state = { directory: '' }

function fixture_path(relative_path: string): string {
	return path.join(state.directory, relative_path)
}

function read_fixture(relative_path: string): string {
	return readFileSync(fixture_path(relative_path), ENCODING)
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

	it('is idempotent — a second cspell pass returns identical content', () => {
		const once = config_patch.patch_cspell_content(CSPELL_WITH_KIT)

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

describe('config patch — lefthook.yml', () => {
	it('replaces the kit sveltekit extends with app-kit and preserves consumer entries', () => {
		const patched = config_patch.patch_lefthook_content(LEFTHOOK_WITH_KIT)
		const extends_list = config_merge.read_yaml_list_field(patched, EXTENDS_FIELD)

		expect(extends_list).toContain(APP_KIT_LEFTHOOK)
		expect(extends_list).not.toContain(KIT_LEFTHOOK)
		expect(extends_list).toContain(CONSUMER_LEFTHOOK_EXTEND)
		// the consumer's own hook block survives — only the extends list is rewritten
		expect(patched).toContain(CONSUMER_LEFTHOOK_COMMAND)
	})

	it('ensures the app-kit extends when no kit sveltekit line is present', () => {
		const without_kit = `extends:\n  - ${CONSUMER_LEFTHOOK_EXTEND}\n`

		expect(config_patch.patch_lefthook_content(without_kit)).toContain(APP_KIT_LEFTHOOK)
	})

	it('drops only the exact sveltekit extend, keeping a sveltekit-prefixed sibling', () => {
		// a sibling preset filename whose segment starts with `sveltekit-`; the `(?![\w-])` anchor
		// must treat it as a distinct segment and leave it untouched
		const sibling = 'node_modules/@joshuafolkken/kit/lefthook/sveltekit-extra.yml'
		const with_sibling = `extends:\n  - ${KIT_LEFTHOOK}\n  - ${sibling}\n`

		const extends_list = config_merge.read_yaml_list_field(
			config_patch.patch_lefthook_content(with_sibling),
			EXTENDS_FIELD,
		)

		expect(extends_list).toContain(sibling)
		expect(extends_list).not.toContain(KIT_LEFTHOOK)
	})

	it('is idempotent — a second lefthook pass returns identical content', () => {
		const once = config_patch.patch_lefthook_content(LEFTHOOK_WITH_KIT)

		expect(config_patch.patch_lefthook_content(once)).toBe(once)
	})
})

describe('config patch — patch_configs file handling', () => {
	it('updates existing config files and reports the change', () => {
		writeFileSync(fixture_path(CSPELL_FILE), CSPELL_WITH_KIT)
		writeFileSync(fixture_path(TSCONFIG_FILE), TSCONFIG_WITH_KIT)
		writeFileSync(fixture_path(LEFTHOOK_FILE), LEFTHOOK_WITH_KIT)

		const changes = config_patch.patch_configs(state.directory)

		expect(changes.find((change) => change.file === CSPELL_FILE)?.action).toBe('updated')
		expect(changes.find((change) => change.file === TSCONFIG_FILE)?.action).toBe('updated')
		expect(changes.find((change) => change.file === LEFTHOOK_FILE)?.action).toBe('updated')
		expect(read_fixture(CSPELL_FILE)).toContain(APP_KIT_CSPELL)
		expect(read_fixture(TSCONFIG_FILE)).toContain(APP_KIT_TSCONFIG)
		expect(read_fixture(LEFTHOOK_FILE)).toContain(APP_KIT_LEFTHOOK)
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
