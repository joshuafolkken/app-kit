import { afterEach, describe, expect, it, vi } from 'vitest'
import { process_runner } from './runner.js'

const SUCCESS = 0
const FAILURE = 2
const PNPM_JS_ENTRY = '/opt/pnpm.cjs'
const PNPM_EXEC_PATH_VARIABLE = 'npm_execpath'
const PNPM_PATH_FALLBACK = { command: 'pnpm', prefix_args: [] }

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('pnpm invocation resolution', () => {
	it('runs a JS pnpm entry through the current node executable', () => {
		const entry = PNPM_JS_ENTRY

		expect(process_runner.resolve_pnpm_invocation(entry)).toEqual({
			command: process.execPath,
			prefix_args: [entry],
		})
	})

	it('runs a standalone pnpm executable directly', () => {
		const entry = '/usr/local/bin/pnpm'

		expect(process_runner.resolve_pnpm_invocation(entry)).toEqual({
			command: entry,
			prefix_args: [],
		})
	})

	// `pnpm josh-app verify` resolves the bin through `pnpm exec` semantics, which leaves
	// npm_execpath unset — so a missing value must fall back to PATH instead of aborting.
	it('falls back to pnpm on PATH when no execpath was exported', () => {
		expect(process_runner.resolve_pnpm_invocation(undefined)).toEqual(PNPM_PATH_FALLBACK)
		expect(process_runner.resolve_pnpm_invocation('')).toEqual(PNPM_PATH_FALLBACK)
	})

	it('rejects package managers other than pnpm', () => {
		for (const entry of ['/usr/local/bin/npm-cli.js', '/usr/local/bin/yarn', '/opt/bun/bin/bun']) {
			expect(() => process_runner.resolve_pnpm_invocation(entry)).toThrow(/requires pnpm/u)
		}
	})

	it('prefixes the pnpm entry ahead of the command argv', () => {
		const invocation = process_runner.resolve_pnpm_invocation(PNPM_JS_ENTRY)

		expect(process_runner.to_pnpm_argv(invocation, ['run', 'build'])).toEqual([
			PNPM_JS_ENTRY,
			'run',
			'build',
		])
	})
})

describe('ambient pnpm invocation', () => {
	// Regression for app-kit#122: the pre-push hook runs josh-app from a plain `git push`, whose
	// environment carries no npm_execpath, and the whole gate aborted before it could build.
	it('resolves an invocation even when the environment carries no execpath', () => {
		vi.stubEnv(PNPM_EXEC_PATH_VARIABLE, undefined)

		expect(process.env[PNPM_EXEC_PATH_VARIABLE]).toBeUndefined()
		expect(process_runner.current_pnpm_invocation()).toEqual(PNPM_PATH_FALLBACK)
	})

	it('prefers the exported pnpm entry over the PATH fallback', () => {
		vi.stubEnv(PNPM_EXEC_PATH_VARIABLE, PNPM_JS_ENTRY)

		expect(process_runner.current_pnpm_invocation()).toEqual({
			command: process.execPath,
			prefix_args: [PNPM_JS_ENTRY],
		})
	})
})

describe('spawn outcome interpretation', () => {
	it('passes a real exit status through unchanged', () => {
		expect(process_runner.to_exit_status({ status: SUCCESS, error: undefined })).toBe(SUCCESS)
		expect(process_runner.to_exit_status({ status: FAILURE, error: undefined })).toBe(FAILURE)
	})

	it('treats a signal kill (no status) as a failure rather than a pass', () => {
		// eslint-disable-next-line unicorn/no-null -- spawnSync reports a signal kill as status null
		const killed = { status: null, error: undefined }

		expect(process_runner.to_exit_status(killed)).not.toBe(SUCCESS)
	})

	it('rethrows a spawn error instead of reporting it as an exit status', () => {
		const failure = new Error('spawn ENOENT')

		// eslint-disable-next-line unicorn/no-null -- a failed spawn has no status
		expect(() => process_runner.to_exit_status({ status: null, error: failure })).toThrow(failure)
	})
})

describe('async command runner', () => {
	const EXIT_CODE = 3

	it('resolves with the child exit status once it closes', async () => {
		const outcome = await process_runner.run_command_async(
			process.execPath,
			['-e', `process.exit(${String(EXIT_CODE)})`],
			process.cwd(),
		)

		expect(outcome.error).toBeUndefined()
		expect(outcome.status).toBe(EXIT_CODE)
	})

	it('resolves with an error (not a rejection) when the binary cannot be spawned', async () => {
		const outcome = await process_runner.run_command_async(
			'definitely-not-a-real-binary-xyz',
			[],
			process.cwd(),
		)

		expect(outcome.error).toBeInstanceOf(Error)
	})
})
