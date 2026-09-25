import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const REPO_ROOT = process.cwd()
const CLI_PATH = path.join(REPO_ROOT, 'scripts/josh-app.ts')

function tracked_file_state(): Map<string, { mtime_ns: bigint; size: bigint }> {
	const files = execFileSync(
		'/usr/bin/git',
		['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
		{
			cwd: REPO_ROOT,
		},
	)
	const paths = files.toString().split('\0').filter(Boolean)
	const state = new Map<string, { mtime_ns: bigint; size: bigint }>()

	for (const file of paths) {
		const file_path = path.join(REPO_ROOT, file)
		if (!existsSync(file_path)) continue

		const stats = statSync(file_path, { bigint: true })

		state.set(file, { mtime_ns: stats.mtimeNs, size: stats.size })
	}

	return state
}

describe('josh-app self-sync preflight', () => {
	it.each(['init', 'sync'])('refuses %s before writing to its own repository', (command) => {
		const files_before = tracked_file_state()
		const result = spawnSync(process.execPath, ['--import', 'tsx', CLI_PATH, command], {
			cwd: REPO_ROOT,
			encoding: 'utf8',
		})

		expect(result.error).toBeUndefined()
		expect(result.status).toBe(1)
		expect(result.stderr).toContain('Refusing to sync: this is @joshuafolkken/app-kit')
		expect(tracked_file_state()).toEqual(files_before)
	})
})
