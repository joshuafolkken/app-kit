import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { EnvironmentError } from '#process/environment-error.js'
import { patch_file } from './patch-file.js'
import type { OverlayChange } from './sync.js'

const ENCODING = 'utf8'
const MANIFEST = 'package.json'

// What a fresh `sv create` project lacks before its first push can pass the pre-push `josh-app
// verify` (app-kit#291): the Cloudflare adapter the managed `preview` script and `wrangler.jsonc`
// build on, the server hook that puts the baseline headers on SSR pages, and the CSP the seeded
// `security-headers.e2e.ts` asserts. Init-only, like the Worker name: each step fills a gap the
// scaffold leaves and then the project owns the result, so `josh-app sync` never comes back to it.

// Where SvelteKit reads its adapter from: `vite.config.*` since SvelteKit 3, `svelte.config.*`
// before it. Each one that exists is patched; a project carries the adapter in exactly one.
const CONFIG_FILES: ReadonlyArray<string> = [
	'vite.config.ts',
	'vite.config.js',
	'vite.config.mts',
	'vite.config.mjs',
	'svelte.config.js',
	'svelte.config.ts',
]

// `sv create` scaffolds adapter-auto, which only picks a platform inside that platform's own build
// environment — a local `vite build` produces no Cloudflare output at all.
const ADAPTER_AUTO = '@sveltejs/adapter-auto'
const ADAPTER_CLOUDFLARE = '@sveltejs/adapter-cloudflare'
const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies'] as const

// A bare `pnpm add` resolves the adapter's `latest` whatever its peers say, so a SvelteKit 2 project
// would receive the adapter built for SvelteKit 3. Each SvelteKit major that `latest` has left
// behind names the adapter major built for it; any other takes `latest`.
const SVELTEKIT = '@sveltejs/kit'
const MAJOR = /\d+/u
const LEGACY_ADAPTER_MAJORS: ReadonlyMap<string, string> = new Map([['2', '7']])

// The CSP is referenced, never pasted: the directives stay single-sourced in app-kit's published
// `security_csp.POLICY`, the same object the seeded E2E spec's expectations are written against.
const CSP_MODULE = '@joshuafolkken/app-kit/security'
const CSP_REFERENCE = 'security_csp.POLICY'
const CSP_KEY = /\bcsp\s*:/u
// The two lines of the scaffold the CSP is anchored to. A config shaped any other way is left alone
// rather than guessed at — the import keeps the file's own quote and semicolon style.
const ADAPTER_IMPORT = /^import adapter from (['"])@sveltejs\/adapter-cloudflare\1(;?)$/mu
const ADAPTER_OPTION = /^([\t ]*)adapter: adapter\(\)(,?)$/mu

const HOOK_TEMPLATE = 'templates/hooks.server.ts'
const SOURCE_DIRECTORY = 'src'
const HOOK_FILE = `${SOURCE_DIRECTORY}/hooks.server.ts`
// `hooks.server.ts`, `hooks.server.js`, or a `hooks.server/` directory — any of them is the
// project's own hook, and a second file beside it would be ambiguous to SvelteKit.
const HOOK_NAME = /^hooks\.server(?:\.|$)/u

const NOT_DEPLOYABLE_MESSAGE = [
	`josh-app start: no SvelteKit config here uses ${ADAPTER_CLOUDFLARE}.`,
	'The first push runs the pre-push `josh-app verify`, which previews the Cloudflare build output',
	'(.svelte-kit/cloudflare/_worker.js) — another adapter does not produce it, so the push would be',
	'refused after the GitHub repository was created.',
	`Use ${ADAPTER_CLOUDFLARE} in vite.config.ts (svelte.config.js before SvelteKit 3), then run`,
	`josh-app start again: https://svelte.dev/docs/kit/adapter-cloudflare. A project still on`,
	`${ADAPTER_AUTO}, as \`sv create\` leaves it, is switched for you.`,
].join('\n')

interface Manifest {
	dependencies?: Record<string, string>
	devDependencies?: Record<string, string>
	[key: string]: unknown
}

function switch_adapter(content: string): string {
	return content.replaceAll(ADAPTER_AUTO, () => ADAPTER_CLOUDFLARE)
}

function can_add_csp(content: string): boolean {
	return !CSP_KEY.test(content) && ADAPTER_IMPORT.test(content) && ADAPTER_OPTION.test(content)
}

// The import goes above the adapter's: `@joshuafolkken` sorts before `@sveltejs`, which is the order
// the distributed ESLint preset asks for. Function replacers, so no `$` is read as a token.
function add_csp(content: string): string {
	if (!can_add_csp(content)) return content

	return content
		.replace(
			ADAPTER_IMPORT,
			(line: string, quote: string, terminator: string) =>
				`import { security_csp } from ${quote}${CSP_MODULE}${quote}${terminator}\n${line}`,
		)
		.replace(
			ADAPTER_OPTION,
			(_line: string, indent: string, comma: string) =>
				`${indent}adapter: adapter(),\n${indent}csp: ${CSP_REFERENCE}${comma}`,
		)
}

function complete_config(content: string): string {
	return add_csp(switch_adapter(content))
}

function uses_adapter(target: string, adapter: string): boolean {
	return CONFIG_FILES.map((file) => path.join(target, file))
		.filter((file) => existsSync(file))
		.some((file) => readFileSync(file, ENCODING).includes(adapter))
}

function declared_range(manifest: Manifest, name: string): string | undefined {
	return DEPENDENCY_FIELDS.map((field) => manifest[field]?.[name]).find(
		(range) => range !== undefined,
	)
}

function declares(manifest: Manifest, name: string): boolean {
	return declared_range(manifest, name) !== undefined
}

// What `pnpm add` is handed: the bare name, or the name at the major the project's SvelteKit needs.
function adapter_specifier(manifest: Manifest): string {
	const major = MAJOR.exec(declared_range(manifest, SVELTEKIT) ?? '')?.[0] ?? ''
	const adapter_major = LEGACY_ADAPTER_MAJORS.get(major)
	if (adapter_major === undefined) return ADAPTER_CLOUDFLARE

	return `${ADAPTER_CLOUDFLARE}@${adapter_major}`
}

function without(manifest: Manifest, name: string): Manifest {
	const pruned: Manifest = { ...manifest }

	for (const field of DEPENDENCY_FIELDS) {
		const entries = Object.entries(manifest[field] ?? {}).filter(([key]) => key !== name)
		if (manifest[field] !== undefined) pruned[field] = Object.fromEntries(entries)
	}

	return pruned
}

function did_drop_stale_adapter(manifest_path: string, manifest: Manifest): boolean {
	if (!declares(manifest, ADAPTER_AUTO)) return false

	const pruned = without(manifest, ADAPTER_AUTO)

	writeFileSync(manifest_path, `${JSON.stringify(pruned, undefined, '\t')}\n`)

	return true
}

// Both lists reach the install step: an addition is handed to `pnpm add`, and a removal alone still
// owes an install, because the lockfile keeps the dropped entry until one runs.
function manifest_change(additions: ReadonlyArray<string>, did_drop: boolean): OverlayChange {
	return {
		file: MANIFEST,
		action: 'updated',
		...(additions.length > 0 && { additions }),
		...(did_drop && { removals: [ADAPTER_AUTO] }),
	}
}

// Decided from the state on disk rather than from what this run patched, so a run interrupted
// between the config edit and the install repairs itself the next time. app-kit names no range:
// at most the adapter major the project's SvelteKit major needs, and `pnpm add` picks the rest.
function swap_adapter_dependency(manifest_path: string): Array<OverlayChange> {
	const manifest = JSON.parse(readFileSync(manifest_path, ENCODING)) as Manifest
	const additions = declares(manifest, ADAPTER_CLOUDFLARE) ? [] : [adapter_specifier(manifest)]
	const did_drop = did_drop_stale_adapter(manifest_path, manifest)
	if (!did_drop && additions.length === 0) return []

	return [manifest_change(additions, did_drop)]
}

function sync_adapter_dependency(target: string): Array<OverlayChange> {
	if (!uses_adapter(target, ADAPTER_CLOUDFLARE)) return []

	return swap_adapter_dependency(path.join(target, MANIFEST))
}

function has_server_hook(target: string): boolean {
	const directory = path.join(target, SOURCE_DIRECTORY)

	return existsSync(directory) && readdirSync(directory).some((name) => HOOK_NAME.test(name))
}

function seed_hook(target: string, source: string): OverlayChange {
	if (has_server_hook(target)) return { file: HOOK_FILE, action: 'skipped' }

	const destination = path.join(target, HOOK_FILE)

	mkdirSync(path.dirname(destination), { recursive: true })
	writeFileSync(destination, readFileSync(path.join(source, HOOK_TEMPLATE), ENCODING))

	return { file: HOOK_FILE, action: 'created' }
}

// `source` is app-kit's package root (holds templates/); `target` is the project being initialized.
// Only a config this run rewrote is reported — the ones it did not find are not the project's.
function complete(target: string, source: string): Array<OverlayChange> {
	const configs = CONFIG_FILES.map((file) => patch_file(target, file, complete_config))

	return [
		...configs.filter((change) => change.action === 'updated'),
		...sync_adapter_dependency(target),
		seed_hook(target, source),
	]
}

// What `josh-app start` asks before it creates anything, beside the Docker check: will the project
// build for Cloudflare once init has run? adapter-auto passes because init switches it.
function assert_deployable(target: string): void {
	if (uses_adapter(target, ADAPTER_CLOUDFLARE) || uses_adapter(target, ADAPTER_AUTO)) return

	throw new EnvironmentError(NOT_DEPLOYABLE_MESSAGE)
}

const cloudflare_scaffold = {
	CONFIG_FILES,
	ADAPTER_CLOUDFLARE,
	HOOK_FILE,
	switch_adapter,
	add_csp,
	complete,
	assert_deployable,
}

export { cloudflare_scaffold }
