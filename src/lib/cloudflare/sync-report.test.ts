import { readFileSync, writeFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { managed_scripts } from './managed-scripts.js'
import { sync_fixture } from './sync-fixture.js'
import { cloudflare_sync, type OverlayChange, type ScriptChange } from './sync.js'

const { ENCODING, SOURCE_DIR, PACKAGE_JSON, DEV_KEY, STALE_DEV_VALUE, CONSUMER_KEY } = sync_fixture

const FAST_CHECK_PACKAGE = 'svelte-fast-check'
// A managed key the fixture manifest does not carry at all, so the overlay adds it rather than
// replacing anything — the other half of the added/replaced distinction.
const ABSENT_MANAGED_KEY = 'preview'
// What a nested script row is indented by; a plain file line never carries it.
const NESTED_INDENT_WIDTH = 4
const NESTED_INDENT = ' '.repeat(NESTED_INDENT_WIDTH)
// A script value that is not a command at all. The manifest is a consumer's JSON, so the declared
// string type is a claim, not a guarantee.
const NON_STRING_VALUE = 0

interface Manifest {
	scripts: Record<string, string>
	devDependencies?: Record<string, string>
}

function manifest_change(): OverlayChange | undefined {
	return cloudflare_sync
		.apply_overlay(sync_fixture.directory(), SOURCE_DIR)
		.find((change) => change.file === PACKAGE_JSON)
}

// Narrowing lives here rather than inline in the assertion: `previous` exists only on the replaced
// variant, and doing the check once keeps each test body a single comparison.
function by_name(left: string, right: string): number {
	return left.localeCompare(right)
}

function previous_of(change: ScriptChange | undefined): unknown {
	if (change?.kind !== 'replaced') return undefined

	return change.previous
}

function rewrite_manifest(edit: (manifest: Manifest) => void): void {
	const file = sync_fixture.path_of(PACKAGE_JSON)
	const manifest = JSON.parse(readFileSync(file, ENCODING)) as Manifest

	edit(manifest)
	writeFileSync(file, `${JSON.stringify(manifest, undefined, '\t')}\n`)
}

beforeEach(() => {
	sync_fixture.create()
})

afterEach(() => {
	sync_fixture.remove()
})

// #189: the overlay overwrites every managed script unconditionally — that is the point of app-kit
// mastering them — but it reported the whole operation as one line, `updated: package.json`. A
// consumer whose `dev` carried a `--host` flag or a `pnpm gen` pre-step lost it silently and found
// out later, from whatever stopped working. #188 raised the stakes by bringing `dev` under
// management: unlike `preview` or the `prepare:*` chain, `dev` is a script consumers routinely edit.
describe('cloudflare sync manifest report (#189)', () => {
	it('names a managed script it replaced, and what the consumer had there', () => {
		const replaced = manifest_change()?.scripts?.find((script) => script.key === DEV_KEY)

		expect(replaced?.kind).toBe('replaced')
		expect(previous_of(replaced)).toBe(STALE_DEV_VALUE)
	})

	it('distinguishes a key it merely added from one it replaced', () => {
		const added = manifest_change()?.scripts?.find((script) => script.key === ABSENT_MANAGED_KEY)

		expect(added?.kind).toBe('added')
		// The union already makes `previous` unreachable on this variant at compile time; this pins
		// that nothing puts one there at run time either.
		expect(added === undefined || Object.hasOwn(added, 'previous')).toBe(false)
	})

	it('reports every managed key that moved and none that did not', () => {
		const reported = (manifest_change()?.scripts ?? []).map((script) => script.key)

		// The fixture starts with a stale `dev` and no other managed key, so the first sync moves all
		// of them — anything less is a key the report dropped. The consumer's own `deploy` is the
		// control: the overlay never touches it, so naming it would be a false alarm.
		expect(reported.toSorted(by_name)).toEqual(
			[...managed_scripts.MANAGED_SCRIPT_KEYS].toSorted(by_name),
		)
		expect(reported).not.toContain(CONSUMER_KEY)
	})
})

describe('cloudflare sync manifest report — edge cases (#189)', () => {
	it('drops the entry entirely once the manifest is already canonical', () => {
		cloudflare_sync.apply_overlay(sync_fixture.directory(), SOURCE_DIR)

		const second = manifest_change()

		expect(second?.action).toBe('skipped')
		expect(second?.scripts).toBeUndefined()
	})

	// A value the type says is a string but a consumer's JSON need not make one. It must not be
	// reported as a replaced command — `summarize` would then be handed something it cannot render,
	// and only after the manifest was already written.
	it('still reports a non-string previous value as replaced, rendered as its JSON text', () => {
		rewrite_manifest((manifest) => {
			const { scripts }: { scripts: Record<string, unknown> } = manifest

			scripts[DEV_KEY] = NON_STRING_VALUE
		})

		const changes = cloudflare_sync.apply_overlay(sync_fixture.directory(), SOURCE_DIR)
		const reported = changes
			.find((change) => change.file === PACKAGE_JSON)
			?.scripts?.find((script) => script.key === DEV_KEY)

		// `added` would claim the key was empty. Something was there and the sync destroyed it, which
		// is exactly the loss this report exists to surface.
		expect(reported?.kind).toBe('replaced')
		expect(previous_of(reported)).toBe(NON_STRING_VALUE)
		expect(() => cloudflare_sync.summarize(changes)).not.toThrow()
	})

	// A dependency-only update must keep the single line the summary has always printed — the nested
	// rows exist to explain a script that moved, and inventing them for a run where none did would
	// make the report noise rather than a signal.
	it('omits the script rows when only the devDependency was seeded', () => {
		cloudflare_sync.apply_overlay(sync_fixture.directory(), SOURCE_DIR)
		rewrite_manifest((manifest) => {
			delete manifest.devDependencies?.[FAST_CHECK_PACKAGE]
		})

		const change = manifest_change()

		expect(change?.action).toBe('updated')
		expect(change?.scripts).toBeUndefined()
	})
})

// A value long enough to be elided, shaped like the case that matters: a canonical command with a
// customization appended. The tail is what the reader is looking for, so it must survive.
const LONG_HEAD = 'DEV_PORT=$(josh port dev) && vite dev --port $DEV_PORT --strictPort'
const LONG_TAIL = '--host --open --clearScreen false'
const LONG_DEV_VALUE = `${LONG_HEAD} ${'--force '.repeat(12)}${LONG_TAIL}`

describe('cloudflare sync summary rendering (#189)', () => {
	it('nests the managed-script rows under the manifest line', () => {
		const changes = cloudflare_sync.apply_overlay(sync_fixture.directory(), SOURCE_DIR)
		const summary = cloudflare_sync.summarize(changes)

		expect(summary).toContain(`  updated: ${PACKAGE_JSON}`)
		expect(summary).toContain(`    replaced script: ${DEV_KEY} (was: "${STALE_DEV_VALUE}")`)
		expect(summary).toContain(`    added script: ${ABSENT_MANAGED_KEY}`)
	})

	// Printed whole: this summary is the only place the old value appears before it is gone, so a cut
	// would drop the customization the reader came for. The tail is where customizations live.
	it('prints a long previous value in full', () => {
		rewrite_manifest((manifest) => {
			manifest.scripts[DEV_KEY] = LONG_DEV_VALUE
		})

		const changes = cloudflare_sync.apply_overlay(sync_fixture.directory(), SOURCE_DIR)
		const summary = cloudflare_sync.summarize(changes)

		expect(summary).toContain(LONG_HEAD)
		expect(summary).toContain(LONG_TAIL)
	})
})

describe('cloudflare sync malformed manifest (#189)', () => {
	// Encoded once, at render time. Encoding in the model too would print the number 0 as `"0"` —
	// the same row a consumer with the literal string `0` would get, and the report exists to tell
	// the reader what was actually there.
	it('renders a non-string previous value as its own JSON form, not as a quoted string', () => {
		rewrite_manifest((manifest) => {
			const { scripts }: { scripts: Record<string, unknown> } = manifest

			scripts[DEV_KEY] = NON_STRING_VALUE
		})

		const summary = cloudflare_sync.summarize(
			cloudflare_sync.apply_overlay(sync_fixture.directory(), SOURCE_DIR),
		)

		const rendered = JSON.stringify(NON_STRING_VALUE)

		expect(summary).toContain(`replaced script: ${DEV_KEY} (was: ${rendered})`)
		expect(summary).not.toContain(`(was: "${rendered}")`)
	})

	// Assigning keys to an array does not survive `JSON.stringify`, so the overwrite would be dropped
	// while the summary announced every managed script as rewritten. Refusing is the only outcome
	// where the report and the file on disk still agree.
	it('refuses a scripts field that is not an object rather than reporting a phantom rewrite', () => {
		rewrite_manifest((manifest) => {
			const malformed: { scripts: unknown } = manifest

			malformed.scripts = []
		})

		expect(() => cloudflare_sync.apply_overlay(sync_fixture.directory(), SOURCE_DIR)).toThrow(
			/"scripts" field that is not an object/u,
		)
	})
})

describe('cloudflare sync summary rows (#189)', () => {
	// A script value may legally contain a newline, and `summarize` joins its rows with one. Raw
	// interpolation would split this row into extra lines that read as top-level file entries.
	it('keeps a previous value containing a newline on one row', () => {
		rewrite_manifest((manifest) => {
			manifest.scripts[DEV_KEY] = 'vite dev\n  created: not-a-file'
		})

		const changes = cloudflare_sync.apply_overlay(sync_fixture.directory(), SOURCE_DIR)
		const rows = cloudflare_sync
			.summarize(changes)
			.split('\n')
			.filter((row) => row.includes('not-a-file'))

		expect(rows).toHaveLength(1)
		expect(rows[0]?.startsWith(NESTED_INDENT)).toBe(true)
	})

	it('leaves a file with no script changes on a single line', () => {
		const changes = cloudflare_sync.apply_overlay(sync_fixture.directory(), SOURCE_DIR)
		const lines = cloudflare_sync.summarize(changes).split('\n')
		const index = lines.indexOf('  created: src/app.html')

		expect(index).toBeGreaterThan(-1)
		expect(lines[index + 1]?.startsWith(NESTED_INDENT)).toBe(false)
	})
})
