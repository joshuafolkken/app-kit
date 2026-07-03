import type { SpawnOutcome } from '#cloudflare/orchestrate.js'
import { describe, expect, it } from 'vitest'
import { app_check, type PnpmRunner } from './check.js'

const CWD = '/consumer/project'
const SUCCESS = 0
const TYPE_ERROR_STATUS = 2

// Literal argv expectations (not the module's own constants) so a typo in the shipped command
// fails the test instead of being compared against itself.
const SYNC_ARGV = ['exec', 'svelte-kit', 'sync']
const FAST_CHECK_ARGV = ['exec', 'svelte-fast-check', '--incremental']
const CI_CHECK_ARGV = ['exec', 'svelte-check', '--tsconfig', './tsconfig.json']

interface RecordedCall {
	argv: ReadonlyArray<string>
	cwd: string
}

function signal_killed_spawn(): SpawnOutcome {
	// eslint-disable-next-line unicorn/no-null -- spawnSync reports a signal kill as status null
	return { status: null, error: undefined }
}

function make_spawn(statuses: ReadonlyArray<number>): {
	calls: Array<RecordedCall>
	spawn: PnpmRunner
} {
	const calls: Array<RecordedCall> = []

	function spawn(argv: ReadonlyArray<string>, cwd: string): SpawnOutcome {
		calls.push({ argv, cwd })
		// index directly so an over-called spawn throws instead of silently succeeding
		const scripted = statuses[calls.length - 1]
		if (scripted === undefined) throw new Error('spawn called more times than scripted')

		return { status: scripted, error: undefined }
	}

	return { calls, spawn }
}

describe('josh-app check commands', () => {
	it('runs svelte-kit sync then the fast incremental checker for check', () => {
		const { calls, spawn } = make_spawn([SUCCESS, SUCCESS])

		expect(app_check.run_check(CWD, spawn)).toBe(SUCCESS)
		expect(calls.map((call) => call.argv)).toEqual([SYNC_ARGV, FAST_CHECK_ARGV])
	})

	it('runs svelte-kit sync then svelte-check for check:ci', () => {
		const { calls, spawn } = make_spawn([SUCCESS, SUCCESS])

		expect(app_check.run_check_ci(CWD, spawn)).toBe(SUCCESS)
		expect(calls.map((call) => call.argv)).toEqual([SYNC_ARGV, CI_CHECK_ARGV])
	})

	it('passes the consumer cwd to every step', () => {
		const { calls, spawn } = make_spawn([SUCCESS, SUCCESS])

		app_check.run_check_ci(CWD, spawn)

		for (const call of calls) expect(call.cwd).toBe(CWD)
	})

	it('spawns the same package the sync overlay seeds', () => {
		expect(FAST_CHECK_ARGV).toContain(app_check.FAST_CHECK_PACKAGE)
	})
})

describe('josh-app check commands — failure handling', () => {
	it('short-circuits when svelte-kit sync fails and skips the checker', () => {
		const { calls, spawn } = make_spawn([TYPE_ERROR_STATUS])

		expect(app_check.run_check_ci(CWD, spawn)).toBe(TYPE_ERROR_STATUS)
		expect(calls).toHaveLength(1)
	})

	it('propagates the checker non-zero exit status', () => {
		const { spawn } = make_spawn([SUCCESS, TYPE_ERROR_STATUS])

		expect(app_check.run_check(CWD, spawn)).toBe(TYPE_ERROR_STATUS)
	})

	it('treats a signal-killed step (null status) as a failure', () => {
		expect(app_check.run_check(CWD, signal_killed_spawn)).not.toBe(SUCCESS)
	})

	it('throws when the spawn itself errors (pnpm missing)', () => {
		const failure = new Error('spawn pnpm ENOENT')

		function spawn(): SpawnOutcome {
			return { status: SUCCESS, error: failure }
		}

		expect(() => app_check.run_check(CWD, spawn)).toThrow(failure)
	})
})

describe('josh-app check commands — pnpm invocation resolution', () => {
	it('runs a JS pnpm entry through node (corepack / pnpm home layout)', () => {
		const entry = '/Users/dev/Library/pnpm/pnpm.cjs'

		expect(app_check.resolve_pnpm_invocation(entry)).toEqual({
			command: process.execPath,
			prefix_args: [entry],
		})
	})

	it('runs a standalone pnpm executable directly', () => {
		const entry = '/usr/local/bin/pnpm'

		expect(app_check.resolve_pnpm_invocation(entry)).toEqual({
			command: entry,
			prefix_args: [],
		})
	})

	it('rejects a missing npm_execpath with an actionable message', () => {
		expect(() => app_check.resolve_pnpm_invocation(undefined)).toThrow(/run through pnpm/u)
		expect(() => app_check.resolve_pnpm_invocation('')).toThrow(/run through pnpm/u)
	})

	it('rejects npm / yarn / bun entries instead of feeding them pnpm-shaped exec args', () => {
		for (const entry of ['/usr/lib/node_modules/npm/bin/npm-cli.js', '/opt/yarn/yarn.js']) {
			expect(() => app_check.resolve_pnpm_invocation(entry)).toThrow(/requires pnpm/u)
		}
	})
})
