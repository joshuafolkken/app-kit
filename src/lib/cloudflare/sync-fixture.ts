import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

// The throwaway consumer project every overlay test runs against, extracted from sync.test.ts when
// #188 pushed that file past the 300-line cap. The suite splits by what the overlay touches —
// sync.test.ts owns package.json and the config lines patched inside existing files, and
// sync-files.test.ts owns the files it seeds whole — but both drive the same fixture, so the
// scaffolding lives here rather than being cloned into the second file.
// Annotated rather than inferred: consumers read it back off the namespace object below, which
// widens a bare literal to `string` and makes every `readFileSync(path, ENCODING)` in the two test
// files fail to match an overload.
const ENCODING: BufferEncoding = 'utf8'
// app-kit's repo root: holds the canonical package.json plus every overlay source (templates/, k6/).
const SOURCE_DIR = '.'
const PACKAGE_JSON = 'package.json'
const ESLINT_FILE = 'eslint.config.js'
const WRANGLER_JSONC = 'wrangler.jsonc'
const WRANGLER_TEMPLATE = 'templates/wrangler.jsonc'
const VSCODE_SETTINGS = '.vscode/settings.json'
const VSCODE_TEMPLATE = 'templates/settings.sveltekit.json'
const FIXTURE_NAME = 'fixture'
const TEMP_PREFIX = 'app-kit-overlay-'

const DEV_KEY = 'dev'
// The shape every consumer scaffolded before #188 made `dev` a managed key: a bare `vite dev` with
// no port wiring, which binds 5173 while a seeded Playwright waits on 5173 + PORT_SEED. Starting
// the fixture here is what lets a test assert the overlay REPAIRS such a project.
const STALE_DEV_VALUE = 'vite dev'
// A script app-kit does not manage, so the overlay must leave it exactly as the consumer wrote it.
// It has to be a key outside MANAGED_SCRIPT_KEYS: `dev` played this role until #188 brought it
// under management, at which point overwriting it became the correct behavior.
const CONSUMER_KEY = 'deploy'
const CONSUMER_VALUE = 'wrangler deploy'

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

// Holder avoids reassigning a top-level binding from inside the lifecycle hooks.
const state = { directory: '' }

// The guard matters because this is a shared module rather than file-local scaffolding: an empty
// `state.directory` makes `path.join` resolve against the process cwd, which is app-kit's own repo
// root. A test file that forgot the `beforeEach(create)` hook would then have `write_manifest`
// overwrite app-kit's real package.json and the zap / .npmrc cases clobber the repo-root masters —
// destroying the very single source these tests exist to protect.
function path_of(relative_path: string): string {
	if (state.directory.length === 0) {
		throw new Error('sync_fixture: call create() before touching fixture paths')
	}

	return path.join(state.directory, relative_path)
}

function read(relative_path: string): string {
	return readFileSync(path_of(relative_path), ENCODING)
}

function scripts(): Record<string, string> {
	return (JSON.parse(read(PACKAGE_JSON)) as { scripts: Record<string, string> }).scripts
}

function development_dependencies(): Record<string, string> {
	const manifest = JSON.parse(read(PACKAGE_JSON)) as {
		devDependencies?: Record<string, string>
	}

	return manifest.devDependencies ?? {}
}

function write_manifest(dependencies?: Record<string, string>): void {
	const manifest = {
		name: FIXTURE_NAME,
		scripts: { [DEV_KEY]: STALE_DEV_VALUE, [CONSUMER_KEY]: CONSUMER_VALUE },
		...(dependencies !== undefined && { devDependencies: dependencies }),
	}

	writeFileSync(path_of(PACKAGE_JSON), `${JSON.stringify(manifest, undefined, '\t')}\n`)
}

function create(): void {
	state.directory = mkdtempSync(path.join(tmpdir(), TEMP_PREFIX))

	write_manifest()
	writeFileSync(path_of(ESLINT_FILE), CONSUMER_ESLINT_CONTENT)
}

function remove(): void {
	rmSync(state.directory, { recursive: true, force: true })
	// Reset so a later `path_of` hits the guard above rather than the repo root.
	state.directory = ''
}

function directory(): string {
	if (state.directory.length === 0) {
		throw new Error('sync_fixture: call create() before reading the fixture directory')
	}

	return state.directory
}

const sync_fixture = {
	ENCODING,
	SOURCE_DIR,
	PACKAGE_JSON,
	ESLINT_FILE,
	WRANGLER_JSONC,
	WRANGLER_TEMPLATE,
	VSCODE_SETTINGS,
	VSCODE_TEMPLATE,
	FIXTURE_NAME,
	DEV_KEY,
	STALE_DEV_VALUE,
	CONSUMER_KEY,
	CONSUMER_VALUE,
	CONSUMER_ESLINT_CONTENT,
	create,
	remove,
	directory,
	path_of,
	read,
	scripts,
	development_dependencies,
	write_manifest,
}

export { sync_fixture }
