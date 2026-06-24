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

interface TemplateEntry {
	template: string
	dest: string
}

// App-shell files refreshed on every overlay — framework config that should evolve
// with app-kit, so a re-run always re-applies the canonical content.
const SYNC_ENTRIES: ReadonlyArray<TemplateEntry> = [
	{ template: 'app.html', dest: 'src/app.html' },
	{ template: 'app.d.ts', dest: 'src/app.d.ts' },
]

const COMPATIBILITY_DATE_PATTERN = /"compatibility_date"\s*:\s*"([^"]*)"/u

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

function sync_scripts(target: string, source: string): void {
	const target_manifest = path.join(target, MANIFEST)
	const consumer = JSON.parse(readFileSync(target_manifest, ENCODING)) as ConsumerPackage
	const canonical = managed_scripts.read_canonical_scripts(path.join(source, MANIFEST))

	if (!did_apply_managed_scripts(consumer, canonical)) return

	writeFileSync(target_manifest, `${JSON.stringify(consumer, undefined, '\t')}\n`)
}

function copy_template(entry: TemplateEntry, target: string, source: string): void {
	const destination = path.join(target, entry.dest)
	const content = readFileSync(path.join(source, TEMPLATES_DIR, entry.template), ENCODING)

	// Skip the write when the content already matches, so a re-run touches nothing
	// (no mtime churn that could retrigger a watcher / rebuild).
	if (existsSync(destination) && readFileSync(destination, ENCODING) === content) return

	mkdirSync(path.dirname(destination), { recursive: true })
	writeFileSync(destination, content)
}

// Refresh only the `compatibility_date` from the template (the one framework-managed
// field), leaving every consumer-owned field — name, routes, bindings — untouched.
// Mirrors kit's merge_wrangler_jsonc; app-kit now owns this since kit goes
// framework-agnostic.
function merge_compatibility_date(existing: string, template: string): string {
	const date = COMPATIBILITY_DATE_PATTERN.exec(template)?.[1]
	if (date === undefined) return existing

	return existing.replace(COMPATIBILITY_DATE_PATTERN, () => `"compatibility_date": "${date}"`)
}

// wrangler.jsonc is seeded from the template when absent, then consumer-owned: a
// re-sync only advances its compatibility_date, never clobbering name / routes.
function sync_wrangler(target: string, source: string): void {
	const destination = path.join(target, WRANGLER_JSONC)
	const template = readFileSync(path.join(source, TEMPLATES_DIR, WRANGLER_JSONC), ENCODING)

	if (!existsSync(destination)) {
		mkdirSync(path.dirname(destination), { recursive: true })
		writeFileSync(destination, template)

		return
	}

	const existing = readFileSync(destination, ENCODING)
	const merged = merge_compatibility_date(existing, template)
	if (merged === existing) return

	writeFileSync(destination, merged)
}

// Idempotent overlay: apply app-kit's SvelteKit + Cloudflare layer onto a project that
// `josh sync` already manages — the canonical Cloudflare lifecycle scripts, the
// refreshed app-shell templates, and a seeded wrangler.jsonc. Re-running makes no
// change. Touches only app-kit-owned files — never the kit-owned eslint /
// svelte.config / tsconfig. `source` is app-kit's package root (holds the canonical
// package.json + templates/); `target` is the consumer project.
function apply_overlay(target: string, source: string): void {
	sync_scripts(target, source)

	for (const entry of SYNC_ENTRIES) {
		copy_template(entry, target, source)
	}

	sync_wrangler(target, source)
}

const cloudflare_sync = { apply_overlay }

export { cloudflare_sync }
