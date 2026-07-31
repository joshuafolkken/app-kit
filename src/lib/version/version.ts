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
const GLOBAL_REMOVE_COMMAND = `pnpm remove -g ${PACKAGE_NAME}`
const GLOBAL_ADD_PREFIX = `pnpm add -g ${PACKAGE_NAME}@`

// app-kit declares kit as an auto-installed *peer*, and every globally installed package lives in
// its own pnpm root with its own lockfile, where that peer is resolved once and then pinned. A plain
// `pnpm add -g app-kit@<latest>` therefore short-circuits ("Already up to date") whenever the global
// app-kit is already latest, and the bundled kit never moves (app-kit#134). Removing app-kit first
// forces a fresh root, which re-resolves the peer and picks up a newer kit — no explicit kit pin is
// needed, so kit#648's "never install a bare global kit" constraint still holds.
// The separator is `;`, not `&&`, so the hint stays recoverable: if the `add` fails after the
// `remove` succeeded, the user is left without a global app-kit and re-runs this same command — with
// `&&` the now-failing `remove` would block the `add` that repairs the install.
function build_global_upgrade_command(context: UpstreamHookContext): string {
	return `${GLOBAL_REMOVE_COMMAND}; ${GLOBAL_ADD_PREFIX}${context.latest}`
}

// Wire the kit upstream with both effective-global hooks (kit#648): `resolve_effective_version`
// reports the running-relative kit `sync` actually runs, and `resolve_global_upgrade_command`
// upgrades the *downstream global app-kit* — that is what bumps the bundled kit, never a bare kit.
// The global command is built from `context.latest` — app-kit's own latest that kit already fetched
// for the primary report (kit#650) — so `v`/`vu` no longer re-fetch app-kit's latest a second time.
// `is_global_upgrade_command_pinned` stays `false` on purpose: kit's no-op guard suppresses a hint
// whose every pin already matches the installed version, which is exactly the state this command is
// built to repair (app-kit at latest, bundled kit stale). Opting in would silence the fix.
function build_kit_upstream(): UpstreamDescriptor {
	return {
		...kit_package_descriptor,
		resolve_effective_version: cloudflare_orchestrate.resolve_kit_effective_version,
		resolve_global_upgrade_command: build_global_upgrade_command,
		is_global_upgrade_command_pinned: false,
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
