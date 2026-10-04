type ParsedCommand =
	{ kind: 'help' } | { kind: 'run'; command: string } | { kind: 'error'; message: string }

const VERSION = 'version'
const VERSION_UPGRADE = 'version:upgrade'
const UPGRADE_FLAG = '--upgrade'
const ALL_FLAG = '--all'
const HELP_COMMANDS = new Set(['help', '--help', '-h', ALL_FLAG])
// `josh start --init-command` appends `--profile <profile>` to the command it is handed, so `init`
// takes exactly that pair (or nothing) and forwards it to kit's `josh init`. Only `full` is taken:
// the SvelteKit + Cloudflare overlay needs kit's full toolchain, and a basic base under it would be
// committed and published by `josh start` as a mismatched project.
const PROFILE_FLAG = '--profile'
const FULL_PROFILE = 'full'
const PROFILE_PAIR_LENGTH = 2
// `start` fixes both itself — the full profile and `josh-app init` — so a caller's copy is refused
// here instead of reaching kit as a clashing pair.
const START_RESERVED_FLAGS = new Set([PROFILE_FLAG, '--init-command'])
const NO_ARGUMENT_COMMANDS = new Set([
	'sync',
	'check',
	'check:ci',
	'dast',
	'load:stress',
	VERSION_UPGRADE,
])
const COMMAND_ALIASES: Record<string, string> = {
	i: 'init',
	sy: 'sync',
	c: 'check',
	v: VERSION,
	vu: VERSION_UPGRADE,
}

const HELP_MESSAGE = `josh-app — SvelteKit + Cloudflare toolkit

Project:
      start [options]       Run kit's josh start with josh-app init as its setup
  i,  init                  Apply kit base and the app-kit overlay
  sy, sync                  Re-sync kit base and the app-kit overlay

Development:
  c,  check                 Run the fast SvelteKit type-check
      check:ci              Run the strict SvelteKit type-check
      dast                  Run the dynamic security scan
      load [scenario]       Run a load-test scenario
      load:stress           Run the stress-test scenario
      shot <route...>       Capture route screenshots
      verify [files...]     Run the pre-push runtime gate

Versioning:
  v,  version [--upgrade]   Show versions or upgrade global and project installs
      version:upgrade       Upgrade installs (legacy; alias: vu)

Usage: josh-app <command> [options]`

function error(message: string): ParsedCommand {
	return { kind: 'error', message }
}

function parse_help(args: ReadonlyArray<string>): ParsedCommand {
	if (args.length === 0 || (args.length === 1 && args[0] === ALL_FLAG)) {
		return { kind: 'help' }
	}

	return error('Help takes no arguments other than --all.')
}

function parse_version(args: ReadonlyArray<string>): ParsedCommand {
	if (args.length === 0) return { kind: 'run', command: VERSION }

	if (args.length === 1 && args[0] === UPGRADE_FLAG) {
		return { kind: 'run', command: VERSION_UPGRADE }
	}

	return error('version accepts only --upgrade.')
}

function parse_no_arguments(command: string, args: ReadonlyArray<string>): ParsedCommand {
	if (args.length > 0) return error(`${command} takes no extra arguments.`)

	return { kind: 'run', command }
}

function is_full_profile_pair(args: ReadonlyArray<string>): boolean {
	const [flag, value] = args

	return args.length === PROFILE_PAIR_LENGTH && flag === PROFILE_FLAG && value === FULL_PROFILE
}

function parse_init(args: ReadonlyArray<string>): ParsedCommand {
	if (args.length === 0 || is_full_profile_pair(args)) return { kind: 'run', command: 'init' }

	return error('init accepts only --profile full: the app-kit overlay needs the full toolchain.')
}

// The remaining options are kit's `josh start` switches, which kit validates.
function parse_start(args: ReadonlyArray<string>): ParsedCommand {
	if (args.some((argument) => START_RESERVED_FLAGS.has(argument))) {
		return error('start sets --profile full and --init-command itself; drop them.')
	}

	return { kind: 'run', command: 'start' }
}

function parse_load(args: ReadonlyArray<string>): ParsedCommand {
	if (args.length > 1) return error('load accepts one scenario path.')

	return { kind: 'run', command: 'load' }
}

function parse_verify(args: ReadonlyArray<string>): ParsedCommand {
	if (args[0] === '--') return { kind: 'run', command: 'verify' }

	for (const file of args) {
		if (file.startsWith('-')) return error('verify does not accept options.')
	}

	return { kind: 'run', command: 'verify' }
}

function verify_files(args: ReadonlyArray<string>): ReadonlyArray<string> {
	return args[0] === '--' ? args.slice(1) : args
}

function parse_other(canonical: string, args: ReadonlyArray<string>): ParsedCommand {
	if (NO_ARGUMENT_COMMANDS.has(canonical)) return parse_no_arguments(canonical, args)
	if (canonical === 'shot') return { kind: 'run', command: canonical }

	return error(`Unknown command: ${canonical}. Run 'josh-app --help' for available commands.`)
}

// The commands with options of their own; a Map keeps the `version:upgrade`-style keys as strings.
const ARGUMENT_PARSERS = new Map<string, (args: ReadonlyArray<string>) => ParsedCommand>([
	[VERSION, parse_version],
	['init', parse_init],
	['start', parse_start],
	['load', parse_load],
	['verify', parse_verify],
])

function parse_canonical(canonical: string, args: ReadonlyArray<string>): ParsedCommand {
	const parser = ARGUMENT_PARSERS.get(canonical)

	return parser === undefined ? parse_other(canonical, args) : parser(args)
}

function parse(command: string | undefined, args: ReadonlyArray<string>): ParsedCommand {
	if (command === undefined || HELP_COMMANDS.has(command)) return parse_help(args)

	return parse_canonical(COMMAND_ALIASES[command] ?? command, args)
}

const command_args = { HELP_MESSAGE, parse, verify_files }

export { command_args }
