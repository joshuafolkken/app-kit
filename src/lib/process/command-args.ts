type ParsedCommand =
	{ kind: 'help' } | { kind: 'run'; command: string } | { kind: 'error'; message: string }

const VERSION = 'version'
const VERSION_UPGRADE = 'version:upgrade'
const UPGRADE_FLAG = '--upgrade'
const ALL_FLAG = '--all'
const HELP_COMMANDS = new Set(['help', '--help', '-h', ALL_FLAG])
const NO_ARGUMENT_COMMANDS = new Set([
	'init',
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

function parse_load(args: ReadonlyArray<string>): ParsedCommand {
	if (args.length > 1) return error('load accepts one scenario path.')

	return { kind: 'run', command: 'load' }
}

function parse_verify(args: ReadonlyArray<string>): ParsedCommand {
	for (const file of args) {
		if (file.startsWith('-')) return error('verify does not accept options.')
	}

	return { kind: 'run', command: 'verify' }
}

function parse_other(canonical: string, args: ReadonlyArray<string>): ParsedCommand {
	if (NO_ARGUMENT_COMMANDS.has(canonical)) return parse_no_arguments(canonical, args)
	if (canonical === 'shot') return { kind: 'run', command: canonical }

	return error(`Unknown command: ${canonical}. Run 'josh-app --help' for available commands.`)
}

function parse_canonical(canonical: string, args: ReadonlyArray<string>): ParsedCommand {
	if (canonical === VERSION) return parse_version(args)
	if (canonical === 'load') return parse_load(args)
	if (canonical === 'verify') return parse_verify(args)

	return parse_other(canonical, args)
}

function parse(command: string | undefined, args: ReadonlyArray<string>): ParsedCommand {
	if (command === undefined || HELP_COMMANDS.has(command)) return parse_help(args)

	return parse_canonical(COMMAND_ALIASES[command] ?? command, args)
}

const command_args = { HELP_MESSAGE, parse }

export { command_args }
