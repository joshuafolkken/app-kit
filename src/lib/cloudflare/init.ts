import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { cloudflare_sync, type OverlayChange } from './sync.js'

const MANIFEST = 'package.json'
const WRANGLER_JSONC = 'wrangler.jsonc'
const NAME_PLACEHOLDER = '// "name": "your-project-name",'
const NPM_SCOPE_PATTERN = /^@[^/]+\//u

// Derive a Cloudflare Worker name from a project name: drop the npm scope, lowercase,
// and reduce to the `[a-z0-9-]` charset Worker names allow — each run of disallowed
// characters becomes one hyphen, with no leading / trailing / doubled hyphens. e.g.
// `@scope/blog` -> `blog`, `My Cool App` -> `my-cool-app`.
function derive_worker_name(raw: string): string {
	return raw
		.replace(NPM_SCOPE_PATTERN, '')
		.toLowerCase()
		.replaceAll(/[^\da-z]/gu, '-')
		.split('-')
		.filter(Boolean)
		.join('-')
}

// Fill the seeded wrangler.jsonc's commented name placeholder with the derived Worker
// name. Idempotent and non-destructive: once the name is set (placeholder gone) or the
// consumer chose their own, the file is left untouched.
function set_worker_name(target: string, name: string): void {
	// A degenerate project name (e.g. all symbols) reduces to ''. Leave the placeholder
	// so the consumer fills it in rather than writing an invalid empty name.
	if (name === '') return

	const wrangler_path = path.join(target, WRANGLER_JSONC)
	const content = readFileSync(wrangler_path, 'utf8')

	if (!content.includes(NAME_PLACEHOLDER)) return

	// Function replacer so a `$` in the name is never read as a replacement token.
	writeFileSync(
		wrangler_path,
		content.replace(NAME_PLACEHOLDER, () => `"name": "${name}",`),
	)
}

// app-kit's init-time overlay: the sync overlay plus the one init-only step — setting the
// Worker name from the project name. `sync` never touches the name (the consumer owns it
// after init), so auto-naming lives here in init rather than in the sync overlay.
function init_overlay(target: string, source: string, project_name: string): Array<OverlayChange> {
	const changes = cloudflare_sync.apply_overlay(target, source)

	set_worker_name(target, derive_worker_name(project_name))

	return changes
}

// Entry the `josh-app init` CLI calls: apply the init overlay to `target`, deriving the
// Worker name from that project's own package.json#name. `source` is app-kit's package
// root (holds the canonical package.json + templates/).
function run_init(target: string, source: string): Array<OverlayChange> {
	const manifest = JSON.parse(readFileSync(path.join(target, MANIFEST), 'utf8')) as {
		name?: unknown
	}

	// A malformed package.json (non-string name) is treated like a missing name: fall back
	// to '' so set_worker_name leaves the placeholder rather than crashing on `.replace`.
	const project_name = typeof manifest.name === 'string' ? manifest.name : ''

	return init_overlay(target, source, project_name)
}

const cloudflare_init = { derive_worker_name, set_worker_name, init_overlay, run_init }

export { cloudflare_init }
