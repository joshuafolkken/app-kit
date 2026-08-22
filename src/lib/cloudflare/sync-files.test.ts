import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { baseline } from '#dast/baseline.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { sync_fixture } from './sync-fixture.js'
import { cloudflare_sync } from './sync.js'

// The overlay's whole-file half: what `josh-app sync` seeds or merges as a file, as opposed to the
// package.json keys and in-place config lines sync.test.ts covers. Split out of that file when
// #188 pushed it past the 300-line cap; both drive the shared fixture in sync-fixture.ts.
const { ENCODING, SOURCE_DIR, WRANGLER_JSONC, VSCODE_SETTINGS, VSCODE_TEMPLATE, FIXTURE_NAME } =
	sync_fixture

const PLACEHOLDER_MARKER = 'your-project-name'

const ZAP_BASELINE = 'zap-baseline.conf'
// The single master; the seed is its distributable slice (app-kit-only section stripped).
const ZAP_MASTER = readFileSync(ZAP_BASELINE, ENCODING)
const ZAP_SEED = baseline.distributable(ZAP_MASTER)

const NPMRC = '.npmrc'
const NPMRC_AUTH_LINE = '//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}'
// kit's base writes .npmrc first in the orchestrated `josh-app init` / `josh-app sync`, so by the
// time the overlay runs the file exists with kit's framework-agnostic lines.
const NPMRC_KIT_BASE = '@joshuafolkken:registry=https://npm.pkg.github.com\nengine-strict=true\n'

type OverlayChanges = ReturnType<typeof cloudflare_sync.apply_overlay>

function action_for(changes: OverlayChanges, file: string): string | undefined {
	return changes.find((change) => change.file === file)?.action
}

function apply_overlay(): OverlayChanges {
	return cloudflare_sync.apply_overlay(sync_fixture.directory(), SOURCE_DIR)
}

beforeEach(() => {
	sync_fixture.create()
})

afterEach(() => {
	sync_fixture.remove()
})

describe('cloudflare sync overlay — wrangler.jsonc', () => {
	it('does not re-seed a wrangler.jsonc the consumer already customized', () => {
		const custom = '{ "name": "my-worker" }\n'

		writeFileSync(sync_fixture.path_of(WRANGLER_JSONC), custom)
		apply_overlay()

		expect(sync_fixture.read(WRANGLER_JSONC)).toBe(custom)
	})

	it('preserves an existing wrangler.jsonc compatibility_date — never advances it', () => {
		const existing = '{\n\t"name": "kept-worker",\n\t"compatibility_date": "2020-01-01"\n}\n'

		writeFileSync(sync_fixture.path_of(WRANGLER_JSONC), existing)
		apply_overlay()

		expect(sync_fixture.read(WRANGLER_JSONC)).toBe(existing)
	})

	it('leaves the name placeholder — sync never derives the Worker name (init does)', () => {
		apply_overlay()

		const wrangler = sync_fixture.read(WRANGLER_JSONC)

		expect(wrangler).toContain(PLACEHOLDER_MARKER)
		expect(wrangler).not.toContain(`"name": "${FIXTURE_NAME}"`)
	})
})

function vscode_template(): Record<string, unknown> {
	return JSON.parse(readFileSync(VSCODE_TEMPLATE, ENCODING)) as Record<string, unknown>
}

describe('cloudflare sync overlay — .vscode SvelteKit settings (#67)', () => {
	it('seeds .vscode/settings.json from the template when absent', () => {
		const changes = apply_overlay()

		expect(action_for(changes, VSCODE_SETTINGS)).toBe('created')
		expect(sync_fixture.read(VSCODE_SETTINGS)).toBe(readFileSync(VSCODE_TEMPLATE, ENCODING))
	})

	it('does not overwrite a consumer-customized .vscode/settings.json', () => {
		const custom = '{ "editor.formatOnSave": false }\n'

		mkdirSync(sync_fixture.path_of('.vscode'), { recursive: true })
		writeFileSync(sync_fixture.path_of(VSCODE_SETTINGS), custom)
		const changes = apply_overlay()

		expect(action_for(changes, VSCODE_SETTINGS)).toBe('skipped')
		expect(sync_fixture.read(VSCODE_SETTINGS)).toBe(custom)
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

describe('cloudflare sync overlay — zap-baseline.conf (#111)', () => {
	it('seeds the distributable slice — never the app-kit-only section — when absent', () => {
		const changes = apply_overlay()

		expect(action_for(changes, ZAP_BASELINE)).toBe('created')
		expect(sync_fixture.read(ZAP_BASELINE)).toBe(ZAP_SEED)
		expect(sync_fixture.read(ZAP_BASELINE)).not.toContain(baseline.APP_KIT_ONLY_MARKER)
	})

	it('merges the missing Tier-1 rules into an existing consumer file', () => {
		const consumer = '# my triage\n2\tIGNORE\t(SVG path false positive)\n'

		writeFileSync(sync_fixture.path_of(ZAP_BASELINE), consumer)
		const changes = apply_overlay()

		const merged = sync_fixture.read(ZAP_BASELINE)

		expect(action_for(changes, ZAP_BASELINE)).toBe('updated')
		expect(merged).toContain(consumer.trimEnd())

		for (const line of baseline.active_rule_lines(ZAP_MASTER)) {
			expect(merged).toContain(line)
		}
	})

	it('leaves a consumer file that already carries the Tier-1 rules untouched', () => {
		writeFileSync(sync_fixture.path_of(ZAP_BASELINE), ZAP_SEED)
		const changes = apply_overlay()

		expect(action_for(changes, ZAP_BASELINE)).toBe('skipped')
		expect(sync_fixture.read(ZAP_BASELINE)).toBe(ZAP_SEED)
	})
})

describe('cloudflare sync overlay — .npmrc credential line (#160)', () => {
	it('appends the credential line to the kit-written .npmrc, keeping kit lines', () => {
		writeFileSync(sync_fixture.path_of(NPMRC), NPMRC_KIT_BASE)
		const changes = apply_overlay()

		expect(action_for(changes, NPMRC)).toBe('updated')
		expect(sync_fixture.read(NPMRC)).toBe(`${NPMRC_KIT_BASE}${NPMRC_AUTH_LINE}\n`)
	})

	it('is idempotent — a second overlay leaves .npmrc byte-identical', () => {
		writeFileSync(sync_fixture.path_of(NPMRC), NPMRC_KIT_BASE)
		apply_overlay()
		const after_first = sync_fixture.read(NPMRC)

		const changes = apply_overlay()

		expect(action_for(changes, NPMRC)).toBe('skipped')
		expect(sync_fixture.read(NPMRC)).toBe(after_first)
	})

	it('does not create .npmrc when the consumer has none — kit owns the file', () => {
		const changes = apply_overlay()

		expect(action_for(changes, NPMRC)).toBe('skipped')
		expect(existsSync(sync_fixture.path_of(NPMRC))).toBe(false)
	})
})
