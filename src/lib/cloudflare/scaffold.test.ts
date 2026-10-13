import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { EnvironmentError } from '#process/environment-error.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cloudflare_scaffold } from './scaffold.js'

const ENCODING = 'utf8'
const SOURCE_DIR = '.'
const PACKAGE_JSON = 'package.json'
const VITE_CONFIG = 'vite.config.ts'
const SVELTE_CONFIG = 'svelte.config.js'
const HOOK_TEMPLATE = 'templates/hooks.server.ts'
const OWN_HOOK = 'src/hooks.server.js'
const ADAPTER_AUTO = '@sveltejs/adapter-auto'
const ADAPTER_STATIC = '@sveltejs/adapter-static'
const SVELTEKIT = '@sveltejs/kit'
const { ADAPTER_CLOUDFLARE, HOOK_FILE } = cloudflare_scaffold
const CSP_IMPORT = "import { security_csp } from '@joshuafolkken/app-kit/security'"
const CSP_OPTION = 'csp: security_csp.POLICY'

const ADAPTER_OPTION = 'adapter: adapter(),'

// The manifest change of a project that had adapter-auto and not yet the Cloudflare adapter.
const SWAPPED = {
	file: PACKAGE_JSON,
	action: 'updated',
	additions: [ADAPTER_CLOUDFLARE],
	removals: [ADAPTER_AUTO],
}

// The `vite.config.ts` `sv@1.1.1 create --template minimal` writes, as kit's base step leaves it
// once Prettier has run over it (the state the overlay actually meets). `option` is the adapter
// line, so a case can stand in a config the overlay must not anchor to.
function sv_config(adapter: string, option: string = ADAPTER_OPTION): string {
	return `import adapter from '${adapter}'
import { sveltekit } from '@sveltejs/kit/vite'
import { defineConfig } from 'vite'

export default defineConfig({
	plugins: [
		sveltekit({
			// adapter-auto only supports some environments, see https://svelte.dev/docs/kit/adapter-auto for a list.
			${option}
		}),
	],
})
`
}

const SV_CONFIG = sv_config(ADAPTER_AUTO)
const STATIC_CONFIG = sv_config(ADAPTER_STATIC)
// Configs the CSP must not be anchored to: one that sets its own, and two without the scaffold's
// bare `adapter: adapter()` on the Cloudflare adapter.
const UNANCHORED_CONFIGS = [
	{
		name: 'a config that already sets csp',
		config: sv_config(ADAPTER_AUTO, `csp: {}, ${ADAPTER_OPTION}`),
	},
	{
		name: 'an adapter called with options',
		config: sv_config(ADAPTER_AUTO, 'adapter: adapter({}),'),
	},
	{ name: 'another adapter', config: STATIC_CONFIG },
]

// The same scaffold untouched by Prettier: semicolons, double quotes, no trailing comma.
const RAW_CONFIG = `import adapter from "${ADAPTER_AUTO}";

const config = {
	kit: {
		adapter: adapter()
	}
};
`

const state = { directory: '' }

function fixture_path(relative_path: string): string {
	return path.join(state.directory, relative_path)
}

function read_fixture(relative_path: string): string {
	return readFileSync(fixture_path(relative_path), ENCODING)
}

function write_fixture(relative_path: string, content: string): void {
	mkdirSync(path.dirname(fixture_path(relative_path)), { recursive: true })
	writeFileSync(fixture_path(relative_path), content)
}

function write_manifest(development_dependencies: Record<string, string>): void {
	const manifest = { name: 'fixture', devDependencies: development_dependencies }

	write_fixture(PACKAGE_JSON, `${JSON.stringify(manifest, undefined, '\t')}\n`)
}

function read_development_dependencies(): Record<string, string> {
	const manifest = JSON.parse(read_fixture(PACKAGE_JSON)) as {
		devDependencies: Record<string, string>
	}

	return manifest.devDependencies
}

function assert_deployable(): void {
	cloudflare_scaffold.assert_deployable(state.directory)
}

beforeEach(() => {
	state.directory = mkdtempSync(path.join(tmpdir(), 'app-kit-scaffold-'))
})

afterEach(() => {
	rmSync(state.directory, { recursive: true, force: true })
})

describe('scaffold — the config of a fresh sv project (#291)', () => {
	it('switches adapter-auto to the Cloudflare adapter and leaves the prose about it alone', () => {
		const switched = cloudflare_scaffold.switch_adapter(SV_CONFIG)

		expect(switched).toContain(`import adapter from '${ADAPTER_CLOUDFLARE}'`)
		expect(switched).not.toContain(ADAPTER_AUTO)
		expect(switched).toContain('https://svelte.dev/docs/kit/adapter-auto')
	})

	it('references the published CSP beside the adapter, import first', () => {
		const completed = cloudflare_scaffold.add_csp(cloudflare_scaffold.switch_adapter(SV_CONFIG))

		expect(completed).toContain(`${CSP_IMPORT}\nimport adapter from '${ADAPTER_CLOUDFLARE}'\n`)
		expect(completed).toContain(`\t\t\tadapter: adapter(),\n\t\t\t${CSP_OPTION},\n`)
	})

	it('keeps the quote, semicolon and trailing-comma style of an unformatted config', () => {
		const completed = cloudflare_scaffold.add_csp(cloudflare_scaffold.switch_adapter(RAW_CONFIG))

		expect(completed).toContain('import { security_csp } from "@joshuafolkken/app-kit/security";\n')
		expect(completed).toContain(`\t\tadapter: adapter(),\n\t\t${CSP_OPTION}\n\t}`)
	})

	it.each(UNANCHORED_CONFIGS)('adds no CSP to $name', ({ config }) => {
		const switched = cloudflare_scaffold.switch_adapter(config)

		expect(cloudflare_scaffold.add_csp(switched)).toBe(switched)
	})
})

describe('scaffold — complete (#291)', () => {
	it('completes a fresh sv project: config, dependency and server hook', () => {
		write_fixture(VITE_CONFIG, SV_CONFIG)
		write_manifest({ [ADAPTER_AUTO]: '^8.0.0', vite: '^8.3.0' })

		const changes = cloudflare_scaffold.complete(state.directory, SOURCE_DIR)

		expect(changes).toEqual([
			{ file: VITE_CONFIG, action: 'updated' },
			SWAPPED,
			{ file: HOOK_FILE, action: 'created' },
		])
		expect(read_fixture(VITE_CONFIG)).toContain(CSP_OPTION)
		expect(read_development_dependencies()).toEqual({ vite: '^8.3.0' })
		expect(read_fixture(HOOK_FILE)).toBe(readFileSync(HOOK_TEMPLATE, ENCODING))
	})

	it('patches svelte.config.js, where SvelteKit 2 keeps the adapter', () => {
		write_fixture(SVELTE_CONFIG, RAW_CONFIG)
		write_manifest({ [ADAPTER_AUTO]: '^7.0.0' })

		const changes = cloudflare_scaffold.complete(state.directory, SOURCE_DIR)

		expect(changes[0]).toEqual({ file: SVELTE_CONFIG, action: 'updated' })
		expect(read_fixture(SVELTE_CONFIG)).toContain(ADAPTER_CLOUDFLARE)
	})

	it('changes nothing on a second run', () => {
		write_fixture(VITE_CONFIG, SV_CONFIG)
		write_manifest({ [ADAPTER_AUTO]: '^8.0.0' })
		cloudflare_scaffold.complete(state.directory, SOURCE_DIR)
		// What the install step's `pnpm add` leaves behind.
		write_manifest({ [ADAPTER_CLOUDFLARE]: '^8.0.0' })
		const config_after_first = read_fixture(VITE_CONFIG)

		const changes = cloudflare_scaffold.complete(state.directory, SOURCE_DIR)

		expect(changes).toEqual([{ file: HOOK_FILE, action: 'skipped' }])
		expect(read_fixture(VITE_CONFIG)).toBe(config_after_first)
	})
})

describe('scaffold — the adapter dependency (#291)', () => {
	// A bare `pnpm add` takes the adapter's `latest`, whose peer is SvelteKit 3.
	it('asks for the adapter major built for a SvelteKit 2 project', () => {
		write_fixture(SVELTE_CONFIG, RAW_CONFIG)
		write_manifest({ [ADAPTER_AUTO]: '^7.0.0', [SVELTEKIT]: '^2.70.3' })

		const changes = cloudflare_scaffold.complete(state.directory, SOURCE_DIR)

		expect(changes[1]?.additions).toEqual([`${ADAPTER_CLOUDFLARE}@7`])
	})

	it.each(['^3.0.1', 'catalog:'])('asks for the bare adapter when SvelteKit is %s', (range) => {
		write_fixture(VITE_CONFIG, SV_CONFIG)
		write_manifest({ [ADAPTER_AUTO]: '^8.0.0', [SVELTEKIT]: range })

		const changes = cloudflare_scaffold.complete(state.directory, SOURCE_DIR)

		expect(changes[1]?.additions).toEqual([ADAPTER_CLOUDFLARE])
	})

	// Nothing to add, yet the lockfile still holds adapter-auto: the change has to say so, or no
	// install runs and the next `pnpm install --frozen-lockfile` fails.
	it('reports the dropped adapter when the project already declares the Cloudflare one', () => {
		write_fixture(VITE_CONFIG, SV_CONFIG)
		write_manifest({ [ADAPTER_AUTO]: '^8.0.0', [ADAPTER_CLOUDFLARE]: '^8.0.0' })

		const changes = cloudflare_scaffold.complete(state.directory, SOURCE_DIR)

		expect(changes[1]).toEqual({
			file: PACKAGE_JSON,
			action: 'updated',
			removals: [ADAPTER_AUTO],
		})
		expect(read_development_dependencies()).toEqual({ [ADAPTER_CLOUDFLARE]: '^8.0.0' })
	})
})

describe('scaffold — what complete leaves alone (#291)', () => {
	it('asks for the adapter again when an earlier run stopped before the install', () => {
		write_fixture(VITE_CONFIG, SV_CONFIG)
		write_manifest({ [ADAPTER_AUTO]: '^8.0.0' })
		cloudflare_scaffold.complete(state.directory, SOURCE_DIR)

		const changes = cloudflare_scaffold.complete(state.directory, SOURCE_DIR)

		expect(changes).toContainEqual({
			file: PACKAGE_JSON,
			action: 'updated',
			additions: [ADAPTER_CLOUDFLARE],
		})
	})

	it('leaves another adapter and its dependency untouched', () => {
		write_fixture(VITE_CONFIG, STATIC_CONFIG)
		write_manifest({ [ADAPTER_STATIC]: '^4.0.0' })

		const changes = cloudflare_scaffold.complete(state.directory, SOURCE_DIR)

		expect(changes).toEqual([{ file: HOOK_FILE, action: 'created' }])
		expect(read_fixture(VITE_CONFIG)).toBe(STATIC_CONFIG)
		expect(read_development_dependencies()).toEqual({ [ADAPTER_STATIC]: '^4.0.0' })
	})

	it.each([OWN_HOOK, 'src/hooks.server/index.ts'])(
		'never seeds a second server hook beside %s',
		(own_hook) => {
			write_fixture(own_hook, '// mine\n')

			const changes = cloudflare_scaffold.complete(state.directory, SOURCE_DIR)

			expect(changes).toEqual([{ file: HOOK_FILE, action: 'skipped' }])
			expect(existsSync(fixture_path(HOOK_FILE))).toBe(false)
		},
	)
})

describe('scaffold — assert_deployable (#291)', () => {
	it.each([
		{ name: 'the Cloudflare adapter', adapter: ADAPTER_CLOUDFLARE },
		{ name: 'adapter-auto, which init switches', adapter: ADAPTER_AUTO },
	])('passes a config on $name', ({ adapter }) => {
		write_fixture(VITE_CONFIG, sv_config(adapter))

		expect(() => {
			cloudflare_scaffold.assert_deployable(state.directory)
		}).not.toThrow()
	})

	// Vite reads these names too; a project on one must not be told it has no Cloudflare adapter.
	it.each(['vite.config.mts', 'vite.config.mjs'])('reads the adapter from %s', (file) => {
		write_fixture(file, sv_config(ADAPTER_CLOUDFLARE))

		expect(assert_deployable).not.toThrow()
	})

	it('stops a project on another adapter, naming the cause and the fix', () => {
		write_fixture(VITE_CONFIG, STATIC_CONFIG)

		expect(assert_deployable).toThrow(EnvironmentError)
		expect(assert_deployable).toThrow(`no SvelteKit config here uses ${ADAPTER_CLOUDFLARE}`)
		expect(assert_deployable).toThrow('https://svelte.dev/docs/kit/adapter-cloudflare')
	})

	it('stops a directory with no SvelteKit config at all', () => {
		expect(() => {
			cloudflare_scaffold.assert_deployable(state.directory)
		}).toThrow(EnvironmentError)
	})
})
