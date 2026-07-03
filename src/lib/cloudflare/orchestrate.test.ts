import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { cloudflare_orchestrate, type SpawnOutcome } from './orchestrate.js'

const CWD = '/work/consumer-project'

interface SpawnCall {
	bin: string
	argv: ReadonlyArray<string>
	cwd: string
}

// A spawn stub that records its arguments and returns a fixed outcome, so the orchestration is
// exercised without forking a real `josh` subprocess.
function make_spawn(outcome: SpawnOutcome): {
	spawn: (bin: string, argv: ReadonlyArray<string>, cwd: string) => SpawnOutcome
	calls: Array<SpawnCall>
} {
	const calls: Array<SpawnCall> = []

	function spawn(bin: string, argv: ReadonlyArray<string>, cwd: string): SpawnOutcome {
		calls.push({ bin, argv, cwd })

		return outcome
	}

	return { spawn, calls }
}

const OK: SpawnOutcome = { status: 0, error: undefined }

describe('cloudflare orchestrate — bin resolution', () => {
	it("resolves kit's josh bin to an existing file", () => {
		const bin = cloudflare_orchestrate.resolve_kit_josh_bin()

		expect(bin.endsWith('josh.js')).toBe(true)
		expect(existsSync(bin)).toBe(true)
	})

	it('finds a package root by name from any directory depth inside it', () => {
		const repo_root = process.cwd()
		const nested = `${repo_root}/scripts`

		// josh-app.ts relies on this to locate app-kit's root from BOTH scripts/ (tsx source run,
		// one level deep) and dist/scripts/ (published bin, two levels deep)
		expect(cloudflare_orchestrate.find_package_root(nested, '@joshuafolkken/app-kit')).toBe(
			repo_root,
		)
		expect(cloudflare_orchestrate.find_package_root(nested, 'no-such-package')).toBeUndefined()
	})
})

describe('cloudflare orchestrate — command construction', () => {
	it('runs josh sync with no extra args, forwarding the cwd', () => {
		const { spawn, calls } = make_spawn(OK)

		cloudflare_orchestrate.run_base_sync(CWD, spawn)

		expect(calls[0]?.argv).toEqual(['sync'])
		expect(calls[0]?.cwd).toBe(CWD)
		expect(calls[0]?.bin.endsWith('josh.js')).toBe(true)
	})

	it('runs josh init with an explicit sveltekit type to stay non-interactive', () => {
		const { spawn, calls } = make_spawn(OK)

		cloudflare_orchestrate.run_base_init(CWD, spawn)

		expect(calls[0]?.argv).toEqual(['init', '--type', 'sveltekit'])
		expect(calls[0]?.cwd).toBe(CWD)
	})
})

describe('cloudflare orchestrate — failure handling', () => {
	it('throws when the subprocess exits non-zero', () => {
		const { spawn } = make_spawn({ status: 1, error: undefined })

		expect(() => {
			cloudflare_orchestrate.run_base_sync(CWD, spawn)
		}).toThrow('status 1')
	})

	it('rethrows a spawn error ahead of the exit-status check', () => {
		const failure = new Error('spawn ENOENT')
		const { spawn } = make_spawn({ status: 1, error: failure })

		expect(() => {
			cloudflare_orchestrate.run_base_init(CWD, spawn)
		}).toThrow(failure)
	})

	it('does not throw on a successful exit', () => {
		const { spawn } = make_spawn(OK)

		expect(() => {
			cloudflare_orchestrate.run_base_sync(CWD, spawn)
		}).not.toThrow()
	})
})
