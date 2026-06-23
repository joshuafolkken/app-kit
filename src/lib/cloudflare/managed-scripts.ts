import { readFileSync } from 'node:fs'

// The package.json#scripts keys that define app-kit's SvelteKit + Cloudflare
// lifecycle. app-kit owns these as the single source: `sync` / `init` (S3 / S4)
// write their canonical values into a consumer's package.json, and the drift
// guard asserts app-kit's own package.json never diverges from the set it
// distributes. This is the ownership game-kit's jgame currently duplicates and
// will re-base onto (joshuafolkken/game-kit#355).
const BARE_PREPARE = 'prepare'

const MANAGED_SCRIPT_KEYS = [
	'preview',
	BARE_PREPARE,
	'prepare:gen',
	'prepare:sync',
	'prepare:lefthook',
	'prepare:gh-packages',
	'gen',
	'gen:pre',
] as const

type ManagedScriptKey = (typeof MANAGED_SCRIPT_KEYS)[number]
type ManagedScripts = Record<ManagedScriptKey, string>

// Every managed key EXCEPT the bare `prepare` lifecycle script, which npm/pnpm
// strips from a published package.json — so it cannot be read back from an
// installed package and is pinned in CANONICAL_PREPARE instead. The colon-namespaced
// `prepare:*` sub-scripts survive publish and are read back from the manifest.
// Derived from MANAGED_SCRIPT_KEYS so the two lists can never drift.
const PUBLISHED_SCRIPT_KEYS: ReadonlyArray<ManagedScriptKey> = MANAGED_SCRIPT_KEYS.filter(
	(key) => key !== BARE_PREPARE,
)

const CANONICAL_PREPARE =
	'pnpm prepare:gen && pnpm prepare:sync && pnpm prepare:lefthook && pnpm prepare:gh-packages'

const CONSTANT_SCRIPTS: Pick<ManagedScripts, 'prepare'> = { prepare: CANONICAL_PREPARE }

function pick_managed_scripts(scripts: Record<string, string>): ManagedScripts {
	const out: Partial<ManagedScripts> = { ...CONSTANT_SCRIPTS }

	for (const key of PUBLISHED_SCRIPT_KEYS) {
		const value = scripts[key]

		if (typeof value !== 'string') {
			throw new TypeError(`@joshuafolkken/app-kit package.json is missing scripts.${key}`)
		}

		out[key] = value
	}

	return out as ManagedScripts
}

function read_canonical_scripts(manifest_path: string): ManagedScripts {
	const raw = readFileSync(manifest_path, 'utf8')
	const manifest = JSON.parse(raw) as { scripts?: Record<string, string> }

	return pick_managed_scripts(manifest.scripts ?? {})
}

const managed_scripts = {
	MANAGED_SCRIPT_KEYS,
	CANONICAL_PREPARE,
	pick_managed_scripts,
	read_canonical_scripts,
}

export { managed_scripts }
export type { ManagedScriptKey, ManagedScripts }
