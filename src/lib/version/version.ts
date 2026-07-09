import {
	create_version_command_config,
	kit_package_descriptor,
	version_commands,
	type UpstreamDescriptor,
	type VersionCommandConfig,
} from '@joshuafolkken/kit/version'
import { cloudflare_orchestrate } from '#cloudflare/orchestrate.js'

// app-kit consumes kit's parameterized version-command library (kit#604) rather than copying
// it — the only app-kit-specific input is the package name; the versions endpoint is derived
// from it by kit. Everything else (read global/project/running, fetch latest, format,
// upgrade) is single-sourced from `@joshuafolkken/kit/version`.
const PACKAGE_NAME = '@joshuafolkken/app-kit'
const GLOBAL_UPGRADE_PREFIX = `pnpm add -g ${PACKAGE_NAME}@`

// Fetches app-kit's own latest; injectable so hook wiring is unit-testable without a network call.
type LatestResolver = () => string

// Resolve app-kit's own latest for the upstream upgrade-command hook, reusing kit's `read_snapshot`
// fetch rather than re-implementing it (single-source; `latest` is the only field the hook needs).
// The memo dedupes repeat hook invocations within one run. It does NOT reuse the `latest` kit already
// fetched for app-kit's primary report — kit's `() => string` hook signature exposes no such value,
// so `v`/`vu` currently fetch app-kit's latest twice; kit#650 tracks closing that gap upstream.
function create_app_kit_latest_resolver(): LatestResolver {
	const state: { latest?: string } = {}

	return function resolve_app_kit_latest(): string {
		state.latest ??= version_commands.read_snapshot(
			create_version_command_config({ package_name: PACKAGE_NAME }),
		).latest

		return state.latest
	}
}

// Wire the kit upstream with both effective-global hooks (kit#648): `resolve_effective_version`
// reports the running-relative kit `sync` actually runs, and `resolve_global_upgrade_command`
// upgrades the *downstream global app-kit* — that is what bumps the bundled kit, never a bare kit.
function build_kit_upstream(resolve_app_kit_latest: LatestResolver): UpstreamDescriptor {
	return {
		...kit_package_descriptor,
		resolve_effective_version: cloudflare_orchestrate.resolve_kit_effective_version,
		resolve_global_upgrade_command: function build_global_upgrade_command(): string {
			return `${GLOBAL_UPGRADE_PREFIX}${resolve_app_kit_latest()}`
		},
	}
}

// `self_directory` is the running bin's own directory (so the report can show the running install);
// the CLI passes it from the bundled entry point. The kit upstream is single-sourced from kit's own
// export (kit#632) and extended with app-kit's effective-global hooks (app-kit#83) so `josh-app v` /
// `vu` cover the full version chain, including the effective kit `sync` resolves at runtime.
function build_config(
	self_directory: string,
	resolve_app_kit_latest: LatestResolver = create_app_kit_latest_resolver(),
): VersionCommandConfig {
	return create_version_command_config({
		package_name: PACKAGE_NAME,
		upstreams: [build_kit_upstream(resolve_app_kit_latest)],
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
