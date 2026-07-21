import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { app_dast, type ZapWorkspace } from './dast.js'

const ENCODING = 'utf8'
const ZAP_CONFIG_FILE = 'zap-baseline.conf'
const TRIAGED_RULE = '10038\tIGNORE\t(CSP is set at the CDN edge)\n'

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

	it('removes the workspace directory on close, leaving no scan residue', () => {
		const workspace = open_tracked(make_project())

		expect(existsSync(workspace.directory)).toBe(true)

		app_dast.close_workspace(workspace)

		expect(existsSync(workspace.directory)).toBe(false)
	})
})
