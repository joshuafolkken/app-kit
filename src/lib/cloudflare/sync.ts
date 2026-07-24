import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { app_check } from '#check/check.js'
import { config_patch } from './config-patch.js'
import { k6_scenarios } from './k6-scenarios.js'
import { managed_scripts, type ManagedScripts } from './managed-scripts.js'
import { patch_file, type ContentPatcher } from './patch-file.js'

const ENCODING = 'utf8'
const MANIFEST = 'package.json'
// Where the seed-only copies live inside the app-kit package. Not a base path the readers join
// implicitly — every entry spells out its own package-relative path, so an entry sourced from
// elsewhere (the k6 scenarios) needs no special case.
const TEMPLATES_DIR = 'templates'
const WRANGLER_JSONC = 'wrangler.jsonc'
const ZAP_BASELINE_CONF = 'zap-baseline.conf'
// Cloudflare's header directives. Project root, not static/ — adapter-cloudflare throws otherwise.
const HEADERS_FILE = '_headers'
// The k6 scenarios (`josh-app load`): the gentle baseline and the "attacking" stress variant.
// Seeded once as starting points, then the consumer owns and tunes them (app-kit#95). Source and
// destination are the same path because app-kit ships the very scenarios it runs on itself — see
// the single-source note on SEED_ENTRIES.
const K6_SCENARIO = 'k6/load-test.js'
const K6_STRESS_SCENARIO = 'k6/stress-test.js'

interface ConsumerPackage {
	scripts?: Record<string, string>
	devDependencies?: Record<string, string>
	[key: string]: unknown
}

interface SeedEntry {
	template: string
	dest: string
	// The one app-kit-owned edit still ensured on an existing consumer file. Absent for entries the
	// consumer owns outright; present where app-kit must keep a single line correct forever.
	patch?: ContentPatcher
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
//
// settings.sveltekit.json carries the SvelteKit editor delta kit#601 drops (svelte formatter,
// eslint validate/probe incl. svelte, svelte language-server, [svelte]/[css]/[html] formatters,
// playwright.reuseBrowser, css.lint.unknownAtRules). Seed-if-absent rather than a deep JSON merge:
// config-merge exposes no object-merge primitive, and a fresh scaffold has no .vscode/settings.json
// to preserve — once present it is the consumer's. Project-specific (sonarlint) and author-only
// (claudeCode.*) keys are intentionally excluded from the template. See #67.
//
// Two kit-dropped items are intentionally NOT scaffolded (per #67): a consumer vite.config.ts +
// rollup-plugin-visualizer injection (a SvelteKit project always already owns vite.config.ts, so
// seed-if-absent never fires and the anchor-merge is fragile), and the size-limit script/config/
// devDeps (an opt-in bundle-budget tool, too invasive to inject into every consumer). Consumers
// own both.
// zap-baseline.conf carries the consumer's DAST triage decisions (which ZAP rules are IGNOREd,
// and why), so it is seeded once and never rewritten — a re-sync must not silently re-open a
// finding the consumer deliberately baselined, nor discard the recorded reason.
//
// _headers ships a security-header baseline (the rules that close ZAP 10020 / 10021 / 10063).
// Seed-only for the same reason: CSP, CORS, and cache rules are highly project-specific, and
// overwriting them on every sync would clobber a consumer's production header policy.
//
// k6/load-test.js (gentle baseline) and k6/stress-test.js (throughput-ceiling probe) are the
// scenarios `josh-app load` runs. Each is seeded once as a working starting point, then owned by
// the consumer — VUs, duration, and the exercised endpoints are all project-specific, so a re-sync
// must never overwrite a tuned scenario (app-kit#95). The lone exception is the `@ts-nocheck`
// header: the scenarios target k6's runtime, not the app's, so a consumer whose tsconfig
// type-checks `**/*.js` cannot compile them. That is app-kit's line to keep correct, and a
// template-only fix would never reach an already-seeded project, so it is ensured on every sync
// (app-kit#109) — additive and idempotent, leaving the tuned body untouched.
//
// The k6 entries are the one pair whose source is NOT under templates/: app-kit runs `josh-app
// load` on its own k6/ scenarios, and those same files are published (package.json `files`) and
// seeded straight from there. A templates/k6 copy would be a second master kept in step only by a
// mirror test — single-sourcing makes "app-kit distributes what it runs" structural instead. The
// app-shell entries keep their templates/ copy because their master lives at src/app.html — a path
// app-kit cannot publish without shipping its library source.
//
// `template` is a path INSIDE the app-kit package; `dest` is the path inside the consumer.
const SEED_ENTRIES: ReadonlyArray<SeedEntry> = [
	{ template: `${TEMPLATES_DIR}/app.html`, dest: 'src/app.html' },
	{ template: `${TEMPLATES_DIR}/app.d.ts`, dest: 'src/app.d.ts' },
	{ template: `${TEMPLATES_DIR}/${WRANGLER_JSONC}`, dest: WRANGLER_JSONC },
	{ template: `${TEMPLATES_DIR}/settings.sveltekit.json`, dest: '.vscode/settings.json' },
	{ template: `${TEMPLATES_DIR}/${ZAP_BASELINE_CONF}`, dest: ZAP_BASELINE_CONF },
	{ template: `${TEMPLATES_DIR}/${HEADERS_FILE}`, dest: HEADERS_FILE },
	{ template: K6_SCENARIO, dest: K6_SCENARIO, patch: k6_scenarios.ensure_ts_nocheck },
	{ template: K6_STRESS_SCENARIO, dest: K6_STRESS_SCENARIO, patch: k6_scenarios.ensure_ts_nocheck },
]

// Fully-managed files app-kit owns end to end: byte-copied on every sync so mechanics fixes reach
// consumers, unlike SEED_ENTRIES which the consumer owns after the first write. Mirrors kit's
// AI_COPY_FILE_MAPPINGS.
//
// Strictly ADDITIVE with respect to .github/workflows: app-kit distributes its own dast.yml and
// must never write ci.yml, which kit single-sources and overwrites on every `josh sync`. Two
// packages mastering one path would make the winner depend on sync order, silently dropping one
// side's content. Enforced by a test.
const MANAGED_COPY_ENTRIES: ReadonlyArray<SeedEntry> = [
	{ template: `${TEMPLATES_DIR}/workflows/dast.yml`, dest: '.github/workflows/dast.yml' },
	{ template: `${TEMPLATES_DIR}/workflows/load.yml`, dest: '.github/workflows/load.yml' },
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

// `josh-app check` spawns the FAST_CHECK_PACKAGE bin (imported from #check so the seeded
// dependency and the spawned bin can never drift apart) in the consumer, and pnpm exposes only
// the consumer's OWN dependency bins — a transitive dep would not resolve. So the overlay seeds
// the devDependency: add-if-absent (an existing pin is the consumer's), appended without
// re-sorting the map (the next `pnpm add` normalizes ordering; a re-sort here would churn
// every devDependency line just to insert one key).
function fast_check_range_of(manifest: ConsumerPackage): string {
	const range = manifest.devDependencies?.[app_check.FAST_CHECK_PACKAGE]
	if (typeof range === 'string') return range

	throw new TypeError(
		`@joshuafolkken/app-kit package.json is missing devDependencies.${app_check.FAST_CHECK_PACKAGE}`,
	)
}

function did_seed_fast_check(consumer: ConsumerPackage, range: string): boolean {
	const development_dependencies = consumer.devDependencies ?? {}
	if (typeof development_dependencies[app_check.FAST_CHECK_PACKAGE] === 'string') return false

	development_dependencies[app_check.FAST_CHECK_PACKAGE] = range
	consumer.devDependencies = development_dependencies

	return true
}

// The Cloudflare lifecycle scripts (and the check-command devDependency) are app-kit-owned:
// a merge that overwrites only the managed keys, leaving the consumer's other entries intact.
// The source manifest is parsed once and shared by both extractions.
function sync_scripts(target: string, source: string): OverlayChange {
	const target_manifest = path.join(target, MANIFEST)
	const consumer = JSON.parse(readFileSync(target_manifest, ENCODING)) as ConsumerPackage
	const source_package = JSON.parse(
		readFileSync(path.join(source, MANIFEST), ENCODING),
	) as ConsumerPackage
	const canonical = managed_scripts.pick_managed_scripts(source_package.scripts ?? {})

	const did_scripts = did_apply_managed_scripts(consumer, canonical)
	const did_dependency = did_seed_fast_check(consumer, fast_check_range_of(source_package))
	if (!did_scripts && !did_dependency) return { file: MANIFEST, action: 'skipped' }

	writeFileSync(target_manifest, `${JSON.stringify(consumer, undefined, '\t')}\n`)

	return { file: MANIFEST, action: 'updated' }
}

// An existing file is the consumer's: left untouched unless the entry declares a `patch`, the one
// app-kit-owned edit it still ensures — additive, idempotent, and preserving every other byte.
function seed_existing(entry: SeedEntry, target: string): OverlayChange {
	if (entry.patch === undefined) return { file: entry.dest, action: 'skipped' }

	return patch_file(target, entry.dest, entry.patch)
}

// Seed a file from its template only when absent, so customized content is never clobbered.
function seed_file(entry: SeedEntry, target: string, source: string): OverlayChange {
	const destination = path.join(target, entry.dest)

	if (existsSync(destination)) return seed_existing(entry, target)

	const content = readFileSync(path.join(source, entry.template), ENCODING)

	mkdirSync(path.dirname(destination), { recursive: true })
	writeFileSync(destination, content)

	return { file: entry.dest, action: 'created' }
}

// Byte-copy a fully-managed file, overwriting whatever is there. Identical content reports
// `skipped` rather than `updated` so a re-sync's summary stays honest about what actually moved.
function copy_managed_file(entry: SeedEntry, target: string, source: string): OverlayChange {
	const destination = path.join(target, entry.dest)
	const content = readFileSync(path.join(source, entry.template), ENCODING)
	const did_exist = existsSync(destination)

	if (did_exist && readFileSync(destination, ENCODING) === content) {
		return { file: entry.dest, action: 'skipped' }
	}

	mkdirSync(path.dirname(destination), { recursive: true })
	writeFileSync(destination, content)

	return { file: entry.dest, action: did_exist ? 'updated' : 'created' }
}

// Format an overlay result as an indented, auditable per-file summary.
function summarize(changes: ReadonlyArray<OverlayChange>): string {
	return changes.map((change) => `  ${change.action}: ${change.file}`).join('\n')
}

// Idempotent, non-destructive overlay: merge app-kit's Cloudflare lifecycle scripts into
// package.json, seed the app-shell + wrangler files when absent, and reconcile the SvelteKit
// lines app-kit owns in the layered cspell / tsconfig / lefthook configs. Re-running an already-overlaid
// project changes nothing. Touches only app-kit-owned files and the app-kit-owned `*/sveltekit`
// config lines — never kit's base lines. `source` is app-kit's package root (holds the canonical
// package.json + templates/); `target` is the consumer project.
function apply_overlay(target: string, source: string): Array<OverlayChange> {
	const changes = [sync_scripts(target, source)]

	for (const entry of SEED_ENTRIES) {
		changes.push(seed_file(entry, target, source))
	}

	for (const entry of MANAGED_COPY_ENTRIES) {
		changes.push(copy_managed_file(entry, target, source))
	}

	changes.push(...config_patch.patch_configs(target))

	return changes
}

const cloudflare_sync = { SEED_ENTRIES, MANAGED_COPY_ENTRIES, apply_overlay, summarize }

export { cloudflare_sync }
export type { OverlayChange }
