import {
	create_version_command_config,
	kit_package_descriptor,
	version_commands,
} from '@joshuafolkken/kit/version'

// app-kit consumes kit's parameterized version-command library (kit#604) rather than copying
// it — the only app-kit-specific input is the package name; the versions endpoint is derived
// from it by kit. Everything else (read global/project/running, fetch latest, format,
// upgrade) is single-sourced from `@joshuafolkken/kit/version`.
const PACKAGE_NAME = '@joshuafolkken/app-kit'

// `self_directory` is the running bin's own directory (so the report can show the running
// install); the CLI passes it from the bundled entry point. The kit upstream descriptor is
// single-sourced from kit's own export (kit#632) so `josh-app v` / `vu` cover the version chain.
function build_config(self_directory: string): ReturnType<typeof create_version_command_config> {
	return create_version_command_config({
		package_name: PACKAGE_NAME,
		upstreams: [kit_package_descriptor],
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
