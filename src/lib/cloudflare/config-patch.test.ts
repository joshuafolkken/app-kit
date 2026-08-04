import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { config_merge } from '@joshuafolkken/kit/config-merge'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { config_patch } from './config-patch.js'

const ENCODING = 'utf8'
const CSPELL_FILE = 'cspell.config.yaml'
const TSCONFIG_FILE = 'tsconfig.json'
const LEFTHOOK_FILE = 'lefthook.yml'

const KIT_TSCONFIG = '@joshuafolkken/kit/tsconfig/sveltekit.jsonc'
const KIT_TSCONFIG_BASE = '@joshuafolkken/kit/tsconfig/base.jsonc'
// The package-export subpath sync now writes, and the two file-path spellings it migrates away
// from: the raw `node_modules` path an earlier sync wrote, and the pre-#113 `.jsonc` name.
const APP_KIT_TSCONFIG = '@joshuafolkken/app-kit/tsconfig/sveltekit'
const APP_KIT_TSCONFIG_RAW = './node_modules/@joshuafolkken/app-kit/tsconfig/sveltekit.json'
const APP_KIT_TSCONFIG_LEGACY = '@joshuafolkken/app-kit/tsconfig/sveltekit.jsonc'
const KIT_LEFTHOOK = 'node_modules/@joshuafolkken/kit/lefthook/sveltekit.yml'
const KIT_LEFTHOOK_VANILLA = 'node_modules/@joshuafolkken/kit/lefthook/vanilla.yml'
const APP_KIT_LEFTHOOK = 'node_modules/@joshuafolkken/app-kit/lefthook/sveltekit.yml'
const SVELTE_KIT_TSCONFIG = './.svelte-kit/tsconfig.json'
const CONSUMER_LEFTHOOK_EXTEND = 'lefthook/local.yml'
const CONSUMER_LEFTHOOK_COMMAND = 'consumer-hook'
const EXTENDS_FIELD = 'extends'
const CONSUMER_EXCLUDE = 'src/demo/**'
const KIT_CSPELL = '@joshuafolkken/kit/cspell/sveltekit'
const APP_KIT_CSPELL = '@joshuafolkken/app-kit/cspell/sveltekit'

// Minimal consumer cspell.config.yaml on kit's sveltekit import — just enough for the orchestration
// tests below to observe that patch_configs rewrote the file. The cspell content assertions (base
// dedup, ignorePaths, preset propagation) live in config-patch-cspell.test.ts.
const CSPELL_SEED = `version: '0.2'\nimport:\n  - '${KIT_CSPELL}'\n`

// A consumer tsconfig.json extending kit's sveltekit preset plus the generated SvelteKit config,
// with a consumer exclude — the state `josh sync` leaves behind.
const TSCONFIG_WITH_KIT = `{
	"extends": ["./node_modules/${KIT_TSCONFIG}", "${SVELTE_KIT_TSCONFIG}"],
	"compilerOptions": { "module": "NodeNext" },
	"exclude": ["${CONSUMER_EXCLUDE}"]
}
`

// A consumer tsconfig.json that an earlier sync migrated to the app-kit sveltekit preset but that
// still carries kit's redundant base entry in front of it — the state the layered `josh sync`
// (kit base, then app-kit patch) leaves behind.
const TSCONFIG_WITH_BASE = `{
	"extends": ["./node_modules/${KIT_TSCONFIG_BASE}", "${APP_KIT_TSCONFIG}", "${SVELTE_KIT_TSCONFIG}"],
	"exclude": ["${CONSUMER_EXCLUDE}"]
}
`

// A consumer tsconfig.json an earlier sync left on the raw `node_modules` path — the state every
// consumer synced before #141 is in. The entry resolves, so nothing fails loudly; it simply pins
// them to the preset's current file name, which is what the `.jsonc` rename broke last time.
const TSCONFIG_WITH_RAW_PATH = `{
	"extends": ["${APP_KIT_TSCONFIG_RAW}", "${SVELTE_KIT_TSCONFIG}"],
	"exclude": ["${CONSUMER_EXCLUDE}"]
}
`

// A consumer who already hardened their config to the export subpath by hand
// (joshuafolkken/game-kit#415). Sync must leave it exactly as it is.
const TSCONFIG_WITH_EXPORT_SUBPATH = `{
	"extends": ["${APP_KIT_TSCONFIG}", "${SVELTE_KIT_TSCONFIG}"],
	"exclude": ["${CONSUMER_EXCLUDE}"]
}
`

// A consumer tsconfig.json still pointing at the retired `.jsonc` app-kit preset — the state every
// consumer synced before #113 is left in. Playwright (>= 1.62) hard-throws on that entry, so the
// patch has to rewrite it, not merely add the `.json` one beside it.
const TSCONFIG_WITH_LEGACY_PRESET = `{
	"extends": ["./node_modules/${APP_KIT_TSCONFIG_LEGACY}", "${SVELTE_KIT_TSCONFIG}"],
	"exclude": ["${CONSUMER_EXCLUDE}"]
}
`

// A consumer lefthook.yml carrying kit's redundant vanilla base entry in front of the app-kit
// sveltekit preset plus a consumer-local extends — the state the layered `josh sync` leaves behind.
const LEFTHOOK_WITH_VANILLA = `extends:
  - ${KIT_LEFTHOOK_VANILLA}
  - ${APP_KIT_LEFTHOOK}
  - ${CONSUMER_LEFTHOOK_EXTEND}
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

// The patched tsconfig is plain JSON, so its `extends` list can be read back directly. Needed here
// because the `.json` path is a prefix of the retired `.jsonc` one — a substring assertion cannot
// tell "rewritten" from "left in place beside the new entry".
function read_tsconfig_extends(content: string): Array<string> {
	return (JSON.parse(content) as { extends: Array<string> })[EXTENDS_FIELD]
}

beforeEach(() => {
	state.directory = mkdtempSync(path.join(tmpdir(), 'app-kit-patch-'))
})

afterEach(() => {
	rmSync(state.directory, { recursive: true, force: true })
})

describe('config patch — tsconfig.json', () => {
	it('replaces the kit sveltekit extends with app-kit and preserves the rest', () => {
		const patched = config_patch.patch_tsconfig_content(TSCONFIG_WITH_KIT)

		expect(patched).toContain(APP_KIT_TSCONFIG)
		expect(patched).not.toContain(KIT_TSCONFIG)
		expect(patched).toContain(SVELTE_KIT_TSCONFIG)
		expect(patched).toContain(CONSUMER_EXCLUDE)
	})

	it('is idempotent — a second tsconfig pass returns identical content', () => {
		const once = config_patch.patch_tsconfig_content(TSCONFIG_WITH_KIT)

		expect(config_patch.patch_tsconfig_content(once)).toBe(once)
	})
})

describe('config patch — tsconfig base extends dedup', () => {
	it('strips the redundant kit base extends, keeps the rest, and converges on re-run', () => {
		const patched = config_patch.patch_tsconfig_content(TSCONFIG_WITH_BASE)

		expect(patched).not.toContain(KIT_TSCONFIG_BASE)
		expect(patched).toContain(APP_KIT_TSCONFIG)
		expect(patched).toContain(SVELTE_KIT_TSCONFIG)
		expect(patched).toContain(CONSUMER_EXCLUDE)
		expect(config_patch.patch_tsconfig_content(patched)).toBe(patched)
	})

	it('strips the base but leaves a kit tsconfig base-prefixed sibling untouched', () => {
		// a sibling preset filename whose segment starts with `base-`; the `(?![\w-])` anchor must
		// treat it as a distinct segment and leave it untouched
		const sibling = '@joshuafolkken/kit/tsconfig/base-extra.jsonc'
		const with_sibling = `{\n\t"extends": ["./node_modules/${KIT_TSCONFIG_BASE}", "./node_modules/${sibling}", "./node_modules/${APP_KIT_TSCONFIG}"]\n}\n`

		const patched = config_patch.patch_tsconfig_content(with_sibling)

		expect(patched).toContain(sibling)
		expect(patched).not.toContain(`${KIT_TSCONFIG_BASE}"`)
	})
})

describe('config patch — raw node_modules path migrated to the export subpath (#141)', () => {
	it('replaces the raw path rather than stacking the export subpath beside it', () => {
		const patched = config_patch.patch_tsconfig_content(TSCONFIG_WITH_RAW_PATH)

		// the whole point: exactly two entries, the raw one gone. A `toContain` assertion would
		// pass even if both were present, which is the bug this Issue is about.
		expect(read_tsconfig_extends(patched)).toEqual([APP_KIT_TSCONFIG, SVELTE_KIT_TSCONFIG])
		expect(patched).toContain(CONSUMER_EXCLUDE)
	})

	it('is idempotent — a second pass over the migrated raw path returns identical content', () => {
		const once = config_patch.patch_tsconfig_content(TSCONFIG_WITH_RAW_PATH)

		expect(config_patch.patch_tsconfig_content(once)).toBe(once)
	})

	it('leaves a consumer already on the export subpath untouched', () => {
		const patched = config_patch.patch_tsconfig_content(TSCONFIG_WITH_EXPORT_SUBPATH)

		expect(read_tsconfig_extends(patched)).toEqual([APP_KIT_TSCONFIG, SVELTE_KIT_TSCONFIG])
	})
})

describe('config patch — retired .jsonc tsconfig preset (#113)', () => {
	it('rewrites the legacy .jsonc preset entry to the export subpath without duplicating it', () => {
		const patched = config_patch.patch_tsconfig_content(TSCONFIG_WITH_LEGACY_PRESET)

		expect(read_tsconfig_extends(patched)).toEqual([APP_KIT_TSCONFIG, SVELTE_KIT_TSCONFIG])
		expect(patched).toContain(CONSUMER_EXCLUDE)
	})

	it('is idempotent — a second pass over the migrated tsconfig returns identical content', () => {
		const once = config_patch.patch_tsconfig_content(TSCONFIG_WITH_LEGACY_PRESET)

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

describe('config patch — lefthook vanilla extends dedup', () => {
	it('strips the redundant kit vanilla extends, keeps app-kit at the front, and converges', () => {
		const patched = config_patch.patch_lefthook_content(LEFTHOOK_WITH_VANILLA)
		const extends_list = config_merge.read_yaml_list_field(patched, EXTENDS_FIELD)

		expect(extends_list).not.toContain(KIT_LEFTHOOK_VANILLA)
		expect(extends_list).toContain(CONSUMER_LEFTHOOK_EXTEND)
		// the app-kit preset stays first — `front` position is preserved after the vanilla strip
		expect(extends_list[0]).toBe(APP_KIT_LEFTHOOK)
		expect(config_patch.patch_lefthook_content(patched)).toBe(patched)
	})

	it('strips vanilla but leaves a kit lefthook vanilla-prefixed sibling untouched', () => {
		// a sibling preset filename whose segment starts with `vanilla-`; the `(?![\w-])` anchor must
		// treat it as a distinct segment and leave it untouched
		const sibling = 'node_modules/@joshuafolkken/kit/lefthook/vanilla-extra.yml'
		const with_sibling = `extends:\n  - ${KIT_LEFTHOOK_VANILLA}\n  - ${sibling}\n  - ${APP_KIT_LEFTHOOK}\n`

		const extends_list = config_merge.read_yaml_list_field(
			config_patch.patch_lefthook_content(with_sibling),
			EXTENDS_FIELD,
		)

		expect(extends_list).toContain(sibling)
		expect(extends_list).not.toContain(KIT_LEFTHOOK_VANILLA)
	})
})

describe('config patch — patch_configs file handling', () => {
	it('updates existing config files and reports the change', () => {
		writeFileSync(fixture_path(CSPELL_FILE), CSPELL_SEED)
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
		writeFileSync(fixture_path(CSPELL_FILE), CSPELL_SEED)
		writeFileSync(fixture_path(TSCONFIG_FILE), TSCONFIG_WITH_KIT)
		config_patch.patch_configs(state.directory)
		const after_first = read_fixture(CSPELL_FILE)

		const changes = config_patch.patch_configs(state.directory)

		expect(changes.every((change) => change.action === 'skipped')).toBe(true)
		expect(read_fixture(CSPELL_FILE)).toBe(after_first)
	})
})
