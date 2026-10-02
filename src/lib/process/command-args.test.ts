import { describe, expect, it } from 'vitest'
import { command_args } from './command-args.js'

const VERSION_UPGRADE = 'version:upgrade'
const PAGE_FILE = 'src/routes/+page.svelte'
const DASH_FILE = '-theme.css'
const RESOLVE_CASES = [
	['version', [], 'version'],
	['v', [], 'version'],
	['version', ['--upgrade'], VERSION_UPGRADE],
	['v', ['--upgrade'], VERSION_UPGRADE],
	[VERSION_UPGRADE, [], VERSION_UPGRADE],
	['vu', [], VERSION_UPGRADE],
	['i', [], 'init'],
	['sy', [], 'sync'],
	['c', [], 'check'],
	['check:ci', [], 'check:ci'],
	['load', ['custom.js'], 'load'],
	['shot', ['/', '--mobile'], 'shot'],
	['verify', [PAGE_FILE], 'verify'],
	['verify', ['--', DASH_FILE], 'verify'],
] as const
const REJECT_CASES = [
	['version', ['--wrong']],
	['version', ['--upgrade', '--upgrade']],
	[VERSION_UPGRADE, ['--upgrade']],
	['vu', ['--wrong']],
	['init', ['--wrong']],
	['load', ['first.js', 'second.js']],
	['help', ['--wrong']],
	['verify', ['--wrong']],
	['verify', [DASH_FILE]],
	['verify', [PAGE_FILE, '--wrong']],
	['unknown', []],
] as const

describe('josh-app command arguments', () => {
	it.each(RESOLVE_CASES)('resolves %s %j to %s', (command, args, canonical) => {
		expect(command_args.parse(command, args)).toEqual({ kind: 'run', command: canonical })
	})

	it.each([undefined, 'help', '--help', '-h', '--all'])('shows help for %s', (command) => {
		expect(command_args.parse(command, [])).toEqual({ kind: 'help' })
	})

	it.each(REJECT_CASES)('rejects %s %j', (command, args) => {
		expect(command_args.parse(command, args).kind).toBe('error')
	})

	it('passes a leading-dash filename after the argument separator', () => {
		expect(command_args.verify_files(['--', DASH_FILE])).toEqual([DASH_FILE])
		expect(command_args.verify_files([PAGE_FILE])).toEqual([PAGE_FILE])
	})
})
