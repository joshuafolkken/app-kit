import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { app_dast, type ZapWorkspace } from './dast.js'

const ENCODING = 'utf8'
const ZAP_CONFIG_FILE = 'zap-baseline.conf'
const TRIAGED_RULE = '10038\tIGNORE\t(CSP is set at the CDN edge)\n'
// Divisor that leaves just the low 9 octal permission bits of a stat mode (mode % 0o1000).
const PERMISSION_BITS = 0o1000

// Every temp path this file creates, removed after each test so a failing assertion cannot leak
// directories into the OS temp dir.
const created: Array<string> = []

function make_project(): string {
	const directory = mkdtempSync(path.join(tmpdir(), 'app-kit-dast-project-'))

	created.push(directory)

	return directory
}

function open_tracked(project: string): ZapWorkspace {
	const workspace = app_dast.open_workspace(project)

	created.push(workspace.directory)

	return workspace
}

afterEach(() => {
	for (const directory of created) rmSync(directory, { recursive: true, force: true })
	created.length = 0
})

describe('scan workspace on disk', () => {
	it('copies the baseline config into a directory outside the project', () => {
		// The isolation is the point: ZAP writes its generated plan into the mounted directory, so
		// mounting the project itself would leave that artifact in the repo after every scan.
		const project = make_project()

		writeFileSync(path.join(project, ZAP_CONFIG_FILE), TRIAGED_RULE)

		const workspace = open_tracked(project)
		const copied = readFileSync(path.join(workspace.directory, ZAP_CONFIG_FILE), ENCODING)

		expect(workspace.config_file).toBe(ZAP_CONFIG_FILE)
		expect(workspace.directory.startsWith(project)).toBe(false)
		expect(copied).toBe(TRIAGED_RULE)
	})

	it('reports no config when the project has not been seeded yet', () => {
		// Must stay undefined rather than defaulting to the filename: a `-c` pointing at a file
		// ZAP cannot read makes it exit 3 (error) instead of reporting findings.
		const workspace = open_tracked(make_project())

		expect(workspace.config_file).toBeUndefined()
	})

	// `% PERMISSION_BITS` isolates the low 9 octal permission bits without a bitwise `&` (banned).
	it('makes the workspace traversable and writable by the container user', () => {
		// mkdtemp defaults to 0700, which blocks the ZAP container's `zap` user (a different uid on
		// Linux CI) from reaching the mount — the scan dies with PermissionError on
		// /zap/wrk/zap-baseline.conf. This guards that CI-only regression; macOS hid it because
		// Docker Desktop ignores unix perms.
		const workspace = open_tracked(make_project())

		expect(statSync(workspace.directory).mode % PERMISSION_BITS).toBe(0o777)
	})

	it('leaves the copied config readable by the container user', () => {
		const project = make_project()

		writeFileSync(path.join(project, ZAP_CONFIG_FILE), TRIAGED_RULE)
		const workspace = open_tracked(project)
		const mode = statSync(path.join(workspace.directory, ZAP_CONFIG_FILE)).mode % PERMISSION_BITS

		expect(mode).toBe(0o644)
	})

	it('removes the workspace directory on close, leaving no scan residue', () => {
		const workspace = open_tracked(make_project())

		expect(existsSync(workspace.directory)).toBe(true)

		app_dast.close_workspace(workspace)

		expect(existsSync(workspace.directory)).toBe(false)
	})
})
