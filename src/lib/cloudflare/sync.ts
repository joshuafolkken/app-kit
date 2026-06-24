import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { managed_scripts, type ManagedScripts } from './managed-scripts.js'

const ENCODING = 'utf8'
const MANIFEST = 'package.json'
const TEMPLATES_DIR = 'templates'
const WRANGLER_JSONC = 'wrangler.jsonc'

interface ConsumerPackage {
	scripts?: Record<string, string>
	[key: string]: unknown
}

interface SeedEntry {
	template: string
	dest: string
}

type OverlayAction = 'created' | 'skipped' | 'updated'

interface OverlayChange {
	file: string
	action: OverlayAction
}

// Files app-kit seeds once, then the consumer owns. These are heavily customized
// downstream — app.html (lang, analytics/consent, preconnect), app.d.ts (env types),
// wrangler.jsonc (name, routes, bindings, compatibility_date) — so a re-run must never
// clobber them. Seeded only when absent; an existing file is left untouched.
const SEED_ENTRIES: ReadonlyArray<SeedEntry> = [
	{ template: 'app.html', dest: 'src/app.html' },
	{ template: 'app.d.ts', dest: 'src/app.d.ts' },
	{ template: WRANGLER_JSONC, dest: WRANGLER_JSONC },
]

function did_apply_managed_scripts(consumer: ConsumerPackage, canonical: ManagedScripts): boolean {
	const scripts = consumer.scripts ?? {}
	let did_change = false

	for (const key of managed_scripts.MANAGED_SCRIPT_KEYS) {
		if (scripts[key] === canonical[key]) continue

		scripts[key] = canonical[key]
		did_change = true
	}

	consumer.scripts = scripts

	return did_change
}

// The Cloudflare lifecycle scripts are app-kit-owned: a merge that overwrites only the
// managed keys, leaving the consumer's other scripts intact.
function sync_scripts(target: string, source: string): OverlayChange {
	const target_manifest = path.join(target, MANIFEST)
	const consumer = JSON.parse(readFileSync(target_manifest, ENCODING)) as ConsumerPackage
	const canonical = managed_scripts.read_canonical_scripts(path.join(source, MANIFEST))

	if (!did_apply_managed_scripts(consumer, canonical)) return { file: MANIFEST, action: 'skipped' }

	writeFileSync(target_manifest, `${JSON.stringify(consumer, undefined, '\t')}\n`)

	return { file: MANIFEST, action: 'updated' }
}

// Seed a file from its template only when absent; an existing file is the consumer's
// and is left untouched, so customized content is never clobbered.
function seed_file(entry: SeedEntry, target: string, source: string): OverlayChange {
	const destination = path.join(target, entry.dest)

	if (existsSync(destination)) return { file: entry.dest, action: 'skipped' }

	const content = readFileSync(path.join(source, TEMPLATES_DIR, entry.template), ENCODING)

	mkdirSync(path.dirname(destination), { recursive: true })
	writeFileSync(destination, content)

	return { file: entry.dest, action: 'created' }
}

// Format an overlay result as an indented, auditable per-file summary.
function summarize(changes: ReadonlyArray<OverlayChange>): string {
	return changes.map((change) => `  ${change.action}: ${change.file}`).join('\n')
}

// Idempotent, non-destructive overlay: merge app-kit's Cloudflare lifecycle scripts into
// package.json, and seed the app-shell + wrangler files when absent. Re-running an
// already-overlaid project changes nothing. Touches only app-kit-owned files — never the
// kit-owned eslint / svelte.config / tsconfig. `source` is app-kit's package root (holds
// the canonical package.json + templates/); `target` is the consumer project.
function apply_overlay(target: string, source: string): Array<OverlayChange> {
	const changes = [sync_scripts(target, source)]

	for (const entry of SEED_ENTRIES) {
		changes.push(seed_file(entry, target, source))
	}

	return changes
}

const cloudflare_sync = { apply_overlay, summarize }

export { cloudflare_sync }
export type { OverlayChange }
