import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { baseline } from '#dast/baseline.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { managed_scripts } from './managed-scripts.js'
import { cloudflare_sync } from './sync.js'

const ENCODING = 'utf8'
// app-kit's repo root: holds the canonical package.json plus every overlay source (templates/, k6/).
const SOURCE_DIR = '.'
const PACKAGE_JSON = 'package.json'
const WRANGLER_JSONC = 'wrangler.jsonc'
const WRANGLER_TEMPLATE = 'templates/wrangler.jsonc'
const APP_HTML = 'src/app.html'
const APP_D_TS = 'src/app.d.ts'
const ESLINT_FILE = 'eslint.config.js'
// A consumer's own ESLint config with neither the kit vanilla marker nor a `*.configs.recommended`
// marker — so neither kit's `josh sync` (which would treat a `*.configs.recommended` config as a
// convertible vanilla scaffold) nor app-kit's overlay reshapes it. The overlay must leave it as-is.
const CONSUMER_ESLINT_CONTENT = `export default [
	{
		rules: {
			'no-console': 'error',
		},
	},
]
`
// kit's `josh init` vanilla scaffold — the overlay migrates it to the app-kit sveltekit preset.
const KIT_VANILLA_ESLINT_CONTENT = `import { create_vanilla_config } from '@joshuafolkken/kit/eslint/vanilla'

export default create_vanilla_config({
	gitignore_path: new URL('./.gitignore', import.meta.url),
	tsconfig_root_dir: import.meta.dirname,
})
`
const APP_KIT_ESLINT_MODULE = '@joshuafolkken/app-kit/eslint/sveltekit'
const DEV_KEY = 'dev'
const DEV_VALUE = 'vite dev'
const FIXTURE_NAME = 'fixture'
const PLACEHOLDER_MARKER = 'your-project-name'
const CSPELL_FILE = 'cspell.config.yaml'
const TSCONFIG_FILE = 'tsconfig.json'
const KIT_CSPELL = '@joshuafolkken/kit/cspell/sveltekit'
const APP_KIT_CSPELL = '@joshuafolkken/app-kit/cspell/sveltekit'
const VSCODE_SETTINGS = '.vscode/settings.json'
const VSCODE_TEMPLATE = 'templates/settings.sveltekit.json'
const FAST_CHECK_PACKAGE = 'svelte-fast-check'

// Holder avoids reassigning a top-level binding from inside the lifecycle hooks.
const state = { directory: '' }

function fixture_path(relative_path: string): string {
	return path.join(state.directory, relative_path)
}

function read_fixture(relative_path: string): string {
	return readFileSync(fixture_path(relative_path), ENCODING)
}

function fixture_scripts(): Record<string, string> {
	return (JSON.parse(read_fixture(PACKAGE_JSON)) as { scripts: Record<string, string> }).scripts
}

beforeEach(() => {
	state.directory = mkdtempSync(path.join(tmpdir(), 'app-kit-overlay-'))
	const manifest = { name: FIXTURE_NAME, scripts: { [DEV_KEY]: DEV_VALUE } }

	writeFileSync(fixture_path(PACKAGE_JSON), `${JSON.stringify(manifest, undefined, '\t')}\n`)
	writeFileSync(fixture_path(ESLINT_FILE), CONSUMER_ESLINT_CONTENT)
})

afterEach(() => {
	rmSync(state.directory, { recursive: true, force: true })
})

// #183 (kit#825): the overlay must hand consumers the pnpm-free port wiring. Inside
// `$(pnpm josh port …)` pnpm's own stdout — `[ELIFECYCLE] …` on a bad PORT_SEED, install logs when
// node_modules is stale — becomes the port argument, and an inline substitution's failure never
// stops the command it is spliced into. The assignment form fixes both, so a consumer's synced
// `preview` must carry it, byte-identical to app-kit's canonical script.
describe('cloudflare sync port wiring', () => {
	it('writes the consumer preview with the pnpm-free assignment-form port wiring', () => {
		cloudflare_sync.apply_overlay(state.directory, SOURCE_DIR)

		const { preview } = fixture_scripts()

		expect(preview).toBe(managed_scripts.read_canonical_scripts(PACKAGE_JSON).preview)
		expect(preview?.startsWith('PREVIEW_PORT=$(josh port preview) && ')).toBe(true)
		expect(preview).not.toContain('$(pnpm')
	})
})

describe('cloudflare sync overlay', () => {
	it('adds the managed scripts, app-shell templates, and seeds wrangler.jsonc', () => {
		cloudflare_sync.apply_overlay(state.directory, SOURCE_DIR)

		const scripts = fixture_scripts()

		for (const key of managed_scripts.MANAGED_SCRIPT_KEYS) {
			expect(scripts[key], key).toBeTypeOf('string')
		}

		expect(read_fixture(APP_HTML)).toBe(readFileSync('templates/app.html', ENCODING))
		expect(read_fixture(WRANGLER_JSONC)).toBe(readFileSync(WRANGLER_TEMPLATE, ENCODING))
		expect(read_fixture(VSCODE_SETTINGS)).toBe(readFileSync(VSCODE_TEMPLATE, ENCODING))
	})

	it('preserves the consumer non-managed scripts and a consumer-customized eslint config', () => {
		cloudflare_sync.apply_overlay(state.directory, SOURCE_DIR)

		expect(fixture_scripts()[DEV_KEY]).toBe(DEV_VALUE)
		expect(read_fixture(ESLINT_FILE)).toBe(CONSUMER_ESLINT_CONTENT)
	})

	it('migrates a kit vanilla eslint.config.js to the app-kit sveltekit preset', () => {
		writeFileSync(fixture_path(ESLINT_FILE), KIT_VANILLA_ESLINT_CONTENT)

		cloudflare_sync.apply_overlay(state.directory, SOURCE_DIR)

		expect(read_fixture(ESLINT_FILE)).toContain(APP_KIT_ESLINT_MODULE)
		expect(read_fixture(ESLINT_FILE)).not.toContain('@joshuafolkken/kit/eslint/vanilla')
	})

	it('is idempotent — a second overlay leaves package.json byte-identical', () => {
		cloudflare_sync.apply_overlay(state.directory, SOURCE_DIR)
		const after_first = read_fixture(PACKAGE_JSON)

		cloudflare_sync.apply_overlay(state.directory, SOURCE_DIR)

		expect(read_fixture(PACKAGE_JSON)).toBe(after_first)
	})

	it('does not rewrite an app-shell template whose content is unchanged', () => {
		cloudflare_sync.apply_overlay(state.directory, SOURCE_DIR)
		const before = statSync(fixture_path(APP_HTML)).mtimeMs

		cloudflare_sync.apply_overlay(state.directory, SOURCE_DIR)

		expect(statSync(fixture_path(APP_HTML)).mtimeMs).toBe(before)
	})
})

function fixture_development_dependencies(): Record<string, string> {
	const manifest = JSON.parse(read_fixture(PACKAGE_JSON)) as {
		devDependencies?: Record<string, string>
	}

	return manifest.devDependencies ?? {}
}

function write_fixture_manifest(development_dependencies: Record<string, string>): void {
	const manifest = {
		name: FIXTURE_NAME,
		scripts: { [DEV_KEY]: DEV_VALUE },
		devDependencies: development_dependencies,
	}

	writeFileSync(fixture_path(PACKAGE_JSON), `${JSON.stringify(manifest, undefined, '\t')}\n`)
}

describe('cloudflare sync overlay — svelte-fast-check devDependency (#78)', () => {
	it('seeds svelte-fast-check into consumer devDependencies when absent', () => {
		cloudflare_sync.apply_overlay(state.directory, SOURCE_DIR)

		const source_range = (
			JSON.parse(readFileSync(PACKAGE_JSON, ENCODING)) as {
				devDependencies: Record<string, string>
			}
		).devDependencies[FAST_CHECK_PACKAGE]

		expect(fixture_development_dependencies()[FAST_CHECK_PACKAGE]).toBe(source_range)
	})

	it('leaves an existing consumer svelte-fast-check pin untouched', () => {
		const pinned = '0.0.1'

		write_fixture_manifest({ [FAST_CHECK_PACKAGE]: pinned })

		cloudflare_sync.apply_overlay(state.directory, SOURCE_DIR)

		expect(fixture_development_dependencies()[FAST_CHECK_PACKAGE]).toBe(pinned)
	})

	it('appends the seed while preserving the consumer existing key order', () => {
		write_fixture_manifest({ vitest: '^4.0.0', eslint: '^10.0.0' })

		cloudflare_sync.apply_overlay(state.directory, SOURCE_DIR)

		// no re-sort: the consumer's ordering is untouched and the seed lands at the end,
		// so the sync diff stays a one-line change instead of reshuffling every entry
		expect(Object.keys(fixture_development_dependencies())).toEqual([
			'vitest',
			'eslint',
			FAST_CHECK_PACKAGE,
		])
	})
})

describe('cloudflare sync overlay — non-destructive & summary', () => {
	it('does not overwrite an already-customized app.html / app.d.ts', () => {
		const custom_html = '<!doctype html><html lang="%lang%"><!-- analytics --></html>\n'
		const custom_dts = '// custom env types\nexport {}\n'

		mkdirSync(fixture_path('src'), { recursive: true })
		writeFileSync(fixture_path(APP_HTML), custom_html)
		writeFileSync(fixture_path(APP_D_TS), custom_dts)
		cloudflare_sync.apply_overlay(state.directory, SOURCE_DIR)

		expect(read_fixture(APP_HTML)).toBe(custom_html)
		expect(read_fixture(APP_D_TS)).toBe(custom_dts)
	})

	it('reports created files when absent and skipped on a re-run', () => {
		const first = cloudflare_sync.apply_overlay(state.directory, SOURCE_DIR)
		const second = cloudflare_sync.apply_overlay(state.directory, SOURCE_DIR)

		expect(first.find((change) => change.file === APP_HTML)?.action).toBe('created')
		expect(second.find((change) => change.file === APP_HTML)?.action).toBe('skipped')
		expect(cloudflare_sync.summarize(first)).toContain('created: src/app.html')
	})
})

describe('cloudflare sync overlay — cspell / tsconfig SvelteKit lines', () => {
	it('reconciles the kit sveltekit import to app-kit when the consumer config exists', () => {
		const cspell = `version: '0.2'\nimport:\n  - '${KIT_CSPELL}'\nwords: []\n`

		writeFileSync(fixture_path(CSPELL_FILE), cspell)

		const changes = cloudflare_sync.apply_overlay(state.directory, SOURCE_DIR)

		expect(changes.find((change) => change.file === CSPELL_FILE)?.action).toBe('updated')
		expect(read_fixture(CSPELL_FILE)).toContain(APP_KIT_CSPELL)
		expect(read_fixture(CSPELL_FILE)).not.toContain(KIT_CSPELL)
	})

	it('skips the cspell / tsconfig patch when the consumer config files are absent', () => {
		const changes = cloudflare_sync.apply_overlay(state.directory, SOURCE_DIR)

		expect(changes.find((change) => change.file === CSPELL_FILE)?.action).toBe('skipped')
		expect(changes.find((change) => change.file === TSCONFIG_FILE)?.action).toBe('skipped')
	})
})

describe('cloudflare sync overlay — wrangler.jsonc', () => {
	it('does not re-seed a wrangler.jsonc the consumer already customized', () => {
		const custom = '{ "name": "my-worker" }\n'

		writeFileSync(fixture_path(WRANGLER_JSONC), custom)
		cloudflare_sync.apply_overlay(state.directory, SOURCE_DIR)

		expect(read_fixture(WRANGLER_JSONC)).toBe(custom)
	})

	it('preserves an existing wrangler.jsonc compatibility_date — never advances it', () => {
		const existing = '{\n\t"name": "kept-worker",\n\t"compatibility_date": "2020-01-01"\n}\n'

		writeFileSync(fixture_path(WRANGLER_JSONC), existing)
		cloudflare_sync.apply_overlay(state.directory, SOURCE_DIR)

		expect(read_fixture(WRANGLER_JSONC)).toBe(existing)
	})

	it('leaves the name placeholder — sync never derives the Worker name (init does)', () => {
		cloudflare_sync.apply_overlay(state.directory, SOURCE_DIR)

		const wrangler = read_fixture(WRANGLER_JSONC)

		expect(wrangler).toContain(PLACEHOLDER_MARKER)
		expect(wrangler).not.toContain(`"name": "${FIXTURE_NAME}"`)
	})
})

function vscode_template(): Record<string, unknown> {
	return JSON.parse(readFileSync(VSCODE_TEMPLATE, ENCODING)) as Record<string, unknown>
}

describe('cloudflare sync overlay — .vscode SvelteKit settings (#67)', () => {
	it('seeds .vscode/settings.json from the template when absent', () => {
		const changes = cloudflare_sync.apply_overlay(state.directory, SOURCE_DIR)

		expect(changes.find((change) => change.file === VSCODE_SETTINGS)?.action).toBe('created')
		expect(read_fixture(VSCODE_SETTINGS)).toBe(readFileSync(VSCODE_TEMPLATE, ENCODING))
	})

	it('does not overwrite a consumer-customized .vscode/settings.json', () => {
		const custom = '{ "editor.formatOnSave": false }\n'

		mkdirSync(fixture_path('.vscode'), { recursive: true })
		writeFileSync(fixture_path(VSCODE_SETTINGS), custom)
		const changes = cloudflare_sync.apply_overlay(state.directory, SOURCE_DIR)

		expect(changes.find((change) => change.file === VSCODE_SETTINGS)?.action).toBe('skipped')
		expect(read_fixture(VSCODE_SETTINGS)).toBe(custom)
	})

	it('ships the svelte editor delta and excludes project-specific / author-only keys', () => {
		const settings = vscode_template()

		expect(settings['eslint.validate']).toContain('svelte')
		expect(settings['eslint.probe']).toContain('svelte')
		expect(settings['svelte.language-server.runtime']).toBe('node')
		expect(settings['css.lint.unknownAtRules']).toBe('ignore')
		expect(settings).toHaveProperty('[svelte]')
		// project-specific (sonarlint) and author-only (claudeCode.*) keys must not be distributed
		expect(settings).not.toHaveProperty('sonarlint.connectedMode.project')
		expect(Object.keys(settings).some((key) => key.startsWith('claudeCode.'))).toBe(false)
	})
})

const ZAP_BASELINE = 'zap-baseline.conf'
// The single master; the seed is its distributable slice (app-kit-only section stripped).
const ZAP_MASTER = readFileSync(ZAP_BASELINE, ENCODING)
const ZAP_SEED = baseline.distributable(ZAP_MASTER)

function zap_change(changes: ReturnType<typeof cloudflare_sync.apply_overlay>): string | undefined {
	return changes.find((change) => change.file === ZAP_BASELINE)?.action
}

describe('cloudflare sync overlay — zap-baseline.conf (#111)', () => {
	it('seeds the distributable slice — never the app-kit-only section — when absent', () => {
		const changes = cloudflare_sync.apply_overlay(state.directory, SOURCE_DIR)

		expect(zap_change(changes)).toBe('created')
		expect(read_fixture(ZAP_BASELINE)).toBe(ZAP_SEED)
		expect(read_fixture(ZAP_BASELINE)).not.toContain(baseline.APP_KIT_ONLY_MARKER)
	})

	it('merges the missing Tier-1 rules into an existing consumer file', () => {
		const consumer = '# my triage\n2\tIGNORE\t(SVG path false positive)\n'

		writeFileSync(fixture_path(ZAP_BASELINE), consumer)
		const changes = cloudflare_sync.apply_overlay(state.directory, SOURCE_DIR)

		const merged = read_fixture(ZAP_BASELINE)

		expect(zap_change(changes)).toBe('updated')
		expect(merged).toContain(consumer.trimEnd())

		for (const line of baseline.active_rule_lines(ZAP_MASTER)) {
			expect(merged).toContain(line)
		}
	})

	it('leaves a consumer file that already carries the Tier-1 rules untouched', () => {
		writeFileSync(fixture_path(ZAP_BASELINE), ZAP_SEED)
		const changes = cloudflare_sync.apply_overlay(state.directory, SOURCE_DIR)

		expect(zap_change(changes)).toBe('skipped')
		expect(read_fixture(ZAP_BASELINE)).toBe(ZAP_SEED)
	})
})

const NPMRC = '.npmrc'
const NPMRC_AUTH_LINE = '//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}'
// kit's base writes .npmrc first in the orchestrated `josh-app init` / `josh-app sync`, so by the
// time the overlay runs the file exists with kit's framework-agnostic lines.
const NPMRC_KIT_BASE = '@joshuafolkken:registry=https://npm.pkg.github.com\nengine-strict=true\n'

function npmrc_change(
	changes: ReturnType<typeof cloudflare_sync.apply_overlay>,
): string | undefined {
	return changes.find((change) => change.file === NPMRC)?.action
}

describe('cloudflare sync overlay — .npmrc credential line (#160)', () => {
	it('appends the credential line to the kit-written .npmrc, keeping kit lines', () => {
		writeFileSync(fixture_path(NPMRC), NPMRC_KIT_BASE)
		const changes = cloudflare_sync.apply_overlay(state.directory, SOURCE_DIR)

		expect(npmrc_change(changes)).toBe('updated')
		expect(read_fixture(NPMRC)).toBe(`${NPMRC_KIT_BASE}${NPMRC_AUTH_LINE}\n`)
	})

	it('is idempotent — a second overlay leaves .npmrc byte-identical', () => {
		writeFileSync(fixture_path(NPMRC), NPMRC_KIT_BASE)
		cloudflare_sync.apply_overlay(state.directory, SOURCE_DIR)
		const after_first = read_fixture(NPMRC)

		const changes = cloudflare_sync.apply_overlay(state.directory, SOURCE_DIR)

		expect(npmrc_change(changes)).toBe('skipped')
		expect(read_fixture(NPMRC)).toBe(after_first)
	})

	it('does not create .npmrc when the consumer has none — kit owns the file', () => {
		const changes = cloudflare_sync.apply_overlay(state.directory, SOURCE_DIR)

		expect(npmrc_change(changes)).toBe('skipped')
		expect(existsSync(fixture_path(NPMRC))).toBe(false)
	})
})
