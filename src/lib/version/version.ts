import {
	create_version_command_config,
	kit_package_descriptor,
	version_commands,
	type UpstreamDescriptor,
	type UpstreamHookContext,
	type VersionCommandConfig,
} from '@joshuafolkken/kit/version'
import { cloudflare_orchestrate } from '#cloudflare/orchestrate.js'

// app-kit consumes kit's parameterized version-command library (kit#604) rather than copying
// it — the only app-kit-specific input is the package name; the versions endpoint is derived
// from it by kit. Everything else (read global/project/running, fetch latest, format,
// upgrade) is single-sourced from `@joshuafolkken/kit/version`.
const PACKAGE_NAME = '@joshuafolkken/app-kit'
const GLOBAL_UPGRADE_PREFIX = `pnpm add -g ${PACKAGE_NAME}@`

// Wire the kit upstream with both effective-global hooks (kit#648): `resolve_effective_version`
// reports the running-relative kit `sync` actually runs, and `resolve_global_upgrade_command`
// upgrades the *downstream global app-kit* — that is what bumps the bundled kit, never a bare kit.
// The global command is built from `context.latest` — app-kit's own latest that kit already fetched
// for the primary report (kit#650) — so `v`/`vu` no longer re-fetch app-kit's latest a second time.
function build_kit_upstream(): UpstreamDescriptor {
	return {
		...kit_package_descriptor,
		resolve_effective_version: cloudflare_orchestrate.resolve_kit_effective_version,
		resolve_global_upgrade_command: function build_global_upgrade_command(
			context: UpstreamHookContext,
		): string {
			return `${GLOBAL_UPGRADE_PREFIX}${context.latest}`
		},
	}
}

// `self_directory` is the running bin's own directory (so the report can show the running install);
// the CLI passes it from the bundled entry point. The kit upstream is single-sourced from kit's own
// export (kit#632) and extended with app-kit's effective-global hooks (app-kit#83) so `josh-app v` /
// `vu` cover the full version chain, including the effective kit `sync` resolves at runtime.
function build_config(self_directory: string): VersionCommandConfig {
	return create_version_command_config({
		package_name: PACKAGE_NAME,
		upstreams: [build_kit_upstream()],
		self_directory,
	})
}

function run_check(self_directory: string): void {
	version_commands.run_check(build_config(self_directory))
}

function run_upgrade(self_directory: string): number {
	return version_commands.run_upgrade(build_config(self_directory))
}

const app_version = { PACKAGE_NAME, build_config, run_check, run_upgrade }

export { app_version }
