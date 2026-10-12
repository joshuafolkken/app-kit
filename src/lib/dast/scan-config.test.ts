import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { EnvironmentError } from '#process/environment-error.js'
import { afterEach, describe, expect, it } from 'vitest'
import { scan_config } from './scan-config.js'

// Every temp project this file creates, removed after each test.
const created: Array<string> = []

function make_project(config?: string): string {
	const project_root = mkdtempSync(path.join(tmpdir(), 'app-kit-scan-config-'))

	created.push(project_root)
	if (config !== undefined) writeFileSync(path.join(project_root, scan_config.CONFIG_FILE), config)

	return project_root
}

afterEach(() => {
	for (const directory of created.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('scan_config.is_scan_enabled — defaults', () => {
	it('is on when the project has no config file', () => {
		expect(scan_config.is_scan_enabled(make_project())).toBe(true)
	})

	it.each(['{}', '{ "verify": {} }', '{ "verify": null }', '[]', '{ "other": { "dast": false } }'])(
		'is on when the setting is absent: %s',
		(content) => {
			expect(scan_config.is_scan_enabled(make_project(content))).toBe(true)
		},
	)
})

describe('scan_config.is_scan_enabled — explicit setting', () => {
	it.each([true, false])('reads verify.dast: %s', (value) => {
		const project_root = make_project(JSON.stringify({ verify: { dast: value } }))

		expect(scan_config.is_scan_enabled(project_root)).toBe(value)
	})

	it.each(['"false"', '0', 'null'])('refuses a setting that is not a boolean: %s', (value) => {
		const project_root = make_project(`{ "verify": { "dast": ${value} } }`)

		expect(() => scan_config.is_scan_enabled(project_root)).toThrow(EnvironmentError)
		expect(() => scan_config.is_scan_enabled(project_root)).toThrow(
			'verify.dast in josh-app.config.json must be true or false.',
		)
	})

	it('refuses a file that is not valid JSON', () => {
		const project_root = make_project('{ "verify": ')

		expect(() => scan_config.is_scan_enabled(project_root)).toThrow(EnvironmentError)
		expect(() => scan_config.is_scan_enabled(project_root)).toThrow('is not valid JSON')
	})
})

describe('scan_config — the distributed master', () => {
	it('ships with the scan on', () => {
		expect(scan_config.is_scan_enabled(process.cwd())).toBe(true)
	})
})
