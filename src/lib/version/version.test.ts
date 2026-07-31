import { readFileSync } from 'node:fs'
import { KIT_PACKAGE_NAME, type UpstreamHookContext } from '@joshuafolkken/kit/version'
import { cloudflare_orchestrate } from '#cloudflare/orchestrate.js'
import { describe, expect, it } from 'vitest'
import { app_version } from './version.js'

const PACKAGE_NAME = '@joshuafolkken/app-kit'
const SELF_DIR = '/workspace/app-kit/dist/scripts'
const STUB_LATEST = '9.9.9'
const STUB_UPSTREAM_LATEST = '8.8.8'
// The shared hook context kit passes to the effective-global hooks — `latest` is app-kit's own
// latest, already fetched by kit for the primary report (kit#650), not resolved a second time here;
// `upstream_latest` is kit's own latest, added by kit#697.
const CONTEXT: UpstreamHookContext = {
	latest: STUB_LATEST,
	upstream_latest: STUB_UPSTREAM_LATEST,
}
const KIT_MANIFEST = `${process.cwd()}/node_modules/@joshuafolkken/kit/package.json`

// Read the emitted global upgrade hint, failing loudly when the hook is missing — the assertions
// below are about the command's shape, so an absent hook must not silently pass as "not contains".
function read_global_upgrade_command(): string {
	const [kit_upstream] = app_version.build_config(SELF_DIR).upstreams
	const command = kit_upstream?.resolve_global_upgrade_command?.(CONTEXT)
	if (command === undefined) throw new Error('kit upstream exposes no global upgrade command')

	return command
}

describe('app version commands', () => {
	it('builds a kit version-command config targeting app-kit', () => {
		const config = app_version.build_config(SELF_DIR)

		expect(config.package_name).toBe(PACKAGE_NAME)
		expect(config.versions_endpoint).toContain('app-kit/versions')
		expect(config.self_directory).toBe(SELF_DIR)
	})

	it('derives the fix-gh-packages path to kit single published copy (kit#637)', () => {
		const config = app_version.build_config(SELF_DIR)

		// kit >=1.4.0 always targets its own shipped script — app-kit publishes no scripts/, so a
		// package-name-derived path would point at a file that does not exist (kit#622 / kit#637)
		expect(config.fix_gh_packages_path).toContain('@joshuafolkken/kit/scripts/fix-gh-packages')
	})

	it('includes the kit upstream in the version chain', () => {
		const config = app_version.build_config(SELF_DIR)

		expect(config.upstreams).toHaveLength(1)

		const [kit_upstream] = config.upstreams

		expect(kit_upstream?.package_name).toBe('@joshuafolkken/kit')
		expect(kit_upstream?.versions_endpoint).toContain('/npm/kit/versions')
	})
})

describe('app version — kit effective-global hooks (app-kit#83)', () => {
	it('wires both effective-global hooks onto the kit upstream', () => {
		const [kit_upstream] = app_version.build_config(SELF_DIR).upstreams

		// Both hooks must be present — kit only builds the effective report when both are defined.
		expect(typeof kit_upstream?.resolve_effective_version).toBe('function')
		expect(typeof kit_upstream?.resolve_global_upgrade_command).toBe('function')
	})

	it('reports kit effective version via the kit resolver helper (kit#651)', () => {
		const [kit_upstream] = app_version.build_config(SELF_DIR).upstreams
		const installed = JSON.parse(readFileSync(KIT_MANIFEST, 'utf8')) as { version: string }

		expect(kit_upstream?.resolve_effective_version?.(CONTEXT)).toBe(installed.version)
		expect(kit_upstream?.resolve_effective_version?.(CONTEXT)).toBe(
			cloudflare_orchestrate.resolve_kit_effective_version(),
		)
	})

	it('builds the global app-kit upgrade from the context latest (kit#650)', () => {
		// Bumping the global app-kit is what bumps the bundled kit; a bare `pnpm add -g kit` is wrong.
		// The latest comes from the shared hook context kit already fetched — no second resolution.
		expect(read_global_upgrade_command()).toBe(
			`pnpm remove -g ${PACKAGE_NAME}; pnpm add -g ${PACKAGE_NAME}@${STUB_LATEST}`,
		)
	})
})

describe('app version — fresh global root for the kit peer (app-kit#134)', () => {
	it('removes the global app-kit before re-adding it so the kit peer re-resolves', () => {
		// The regression this guards: app-kit already at latest while the bundled kit is stale. A
		// plain `pnpm add -g app-kit@<latest>` short-circuits there, so the removal must come first —
		// only a fresh global root re-resolves the auto-installed kit peer.
		const command = read_global_upgrade_command()

		expect(command.indexOf(`pnpm remove -g ${PACKAGE_NAME}`)).toBeLessThan(
			command.indexOf(`pnpm add -g ${PACKAGE_NAME}@`),
		)
	})

	it('keeps the command re-runnable after a failed re-install', () => {
		// `;` keeps the hint recoverable: re-running it after a failed `add` still repairs the
		// install, whereas `&&` would let the now-failing `remove` block that `add`.
		expect(read_global_upgrade_command()).not.toContain('&&')
	})

	it('never pins the kit version in the global command (kit#648)', () => {
		// kit is an auto-installed peer of the global app-kit — it is never installed standalone, and
		// the fresh root resolves it on its own, so the emitted command must not name kit at all.
		expect(read_global_upgrade_command()).not.toContain(KIT_PACKAGE_NAME)
	})

	it('keeps the no-op upgrade-hint guard opted out (kit#697)', () => {
		const [kit_upstream] = app_version.build_config(SELF_DIR).upstreams

		// kit suppresses a hint whose every version pin already matches what is installed. The
		// fresh-root command pins app-kit at a version that is typically already installed — that is
		// the point, not a no-op — so opting in would hide the very command that fixes the stale kit.
		expect(kit_upstream?.is_global_upgrade_command_pinned).toBe(false)
	})
})
