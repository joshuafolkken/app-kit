import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { e2e_retry } from './e2e-retry.js'

const CRASH_LOG = 'Error in ProxyController\nError: Network connection lost.'
const HEALTHY_FAILURE_LOG = 'Assertion failed while the preview server remained available.'

describe('E2E crash check integration', () => {
	it.each([
		[CRASH_LOG, true],
		[HEALTHY_FAILURE_LOG, false],
		['', false],
	])('uses the kit verdict for a preview log', (log_text, expected) => {
		const directory = mkdtempSync(path.join(tmpdir(), 'josh-app-retry-test-'))

		try {
			writeFileSync(path.join(directory, 'wrangler.log'), log_text)
			expect(e2e_retry.has_crashed(process.cwd(), directory)).toBe(expected)
		} finally {
			rmSync(directory, { recursive: true, force: true })
		}
	})

	it('passes the log path to preview and restores the previous environment', async () => {
		const previous = process.env['WRANGLER_LOG_PATH']
		let directory = ''

		try {
			await e2e_retry.with_logs(async (log_directory) => {
				directory = path.dirname(log_directory)
				expect(process.env['WRANGLER_LOG_PATH']).toBe(log_directory)
			})
			expect(process.env['WRANGLER_LOG_PATH']).toBe(previous)
		} finally {
			if (previous === undefined) delete process.env['WRANGLER_LOG_PATH']
			else process.env['WRANGLER_LOG_PATH'] = previous
		}

		expect(directory).not.toBe('')
	})
})
