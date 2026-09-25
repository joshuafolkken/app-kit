import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { process_runner } from '#process/runner.js'

const LOG_PATH_VARIABLE = 'WRANGLER_LOG_PATH'
const OUTPUT_FILE = 'github-output'
const CRASH_VERDICT = 'crashed=true'
const RETRY_CHECK_ARGV: ReadonlyArray<string> = ['josh', 'e2e:retry-check']

function restore_log_path(previous: string | undefined): void {
	if (previous === undefined) Reflect.deleteProperty(process.env, LOG_PATH_VARIABLE)
	else process.env[LOG_PATH_VARIABLE] = previous
}

async function with_logs<T>(run: (log_directory: string) => Promise<T>): Promise<T> {
	const directory = mkdtempSync(path.join(tmpdir(), 'josh-app-verify-'))
	const previous = process.env[LOG_PATH_VARIABLE]
	const log_directory = `${path.join(directory, 'logs')}${path.sep}`

	process.env[LOG_PATH_VARIABLE] = log_directory

	try {
		return await run(log_directory)
	} finally {
		restore_log_path(previous)
		rmSync(directory, { recursive: true, force: true })
	}
}

function has_crashed(cwd: string, log_directory: string): boolean {
	const output_directory = mkdtempSync(path.join(tmpdir(), 'josh-app-crash-check-'))
	const output_path = path.join(output_directory, OUTPUT_FILE)

	try {
		const result = process_runner.run_pnpm_with_environment(RETRY_CHECK_ARGV, cwd, {
			GITHUB_OUTPUT: output_path,
			WRANGLER_LOG_PATH: log_directory,
		})
		if (process_runner.to_exit_status(result) !== process_runner.SUCCESS_STATUS) return false

		return readFileSync(output_path, 'utf8').split('\n').includes(CRASH_VERDICT)
	} catch {
		process.stdout.write('E2E crash check unavailable; the failed test run will not be retried.\n')

		return false
	} finally {
		rmSync(output_directory, { recursive: true, force: true })
	}
}

const e2e_retry = { with_logs, has_crashed }

export { e2e_retry }
