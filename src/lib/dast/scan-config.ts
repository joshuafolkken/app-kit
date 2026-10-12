import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { EnvironmentError } from '#process/environment-error.js'

// The project's own switch for the pre-push ZAP scan (app-kit#283). The scan needs a Docker daemon,
// and a project that does not keep one can turn the pre-push run off in a file it commits — an
// explicit choice a reviewer can see, which is not the silent skip joshuafolkken/kit#670 ruled out.
// A missing file or a missing key reads as ON, so a project set up before the file existed keeps
// scanning. Only `josh-app verify` and the `josh-app start` preflight read it: a manual
// `josh-app dast` and the CI workflow always scan.
const CONFIG_FILE = 'josh-app.config.json'
const VERIFY_KEY = 'verify'
const DAST_KEY = 'dast'
const DAST_SETTING = `${VERIFY_KEY}.${DAST_KEY}`
const ENCODING = 'utf8'

function is_record(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parse_config(file_path: string): unknown {
	try {
		return JSON.parse(readFileSync(file_path, ENCODING))
	} catch (error) {
		throw new EnvironmentError(`${CONFIG_FILE} is not valid JSON — fix it and re-run.`, {
			cause: error,
		})
	}
}

function read_setting(config: unknown): unknown {
	if (!is_record(config)) return undefined

	const verify = config[VERIFY_KEY]

	return is_record(verify) ? verify[DAST_KEY] : undefined
}

// Anything but a boolean is refused rather than guessed at: reading `"false"` as ON would surprise
// the project, and reading it as OFF would drop a security check on a typo.
function is_scan_enabled(cwd: string): boolean {
	const file_path = path.join(cwd, CONFIG_FILE)
	if (!existsSync(file_path)) return true

	const setting = read_setting(parse_config(file_path))
	if (setting === undefined) return true

	if (typeof setting === 'boolean') return setting

	throw new EnvironmentError(`${DAST_SETTING} in ${CONFIG_FILE} must be true or false.`)
}

const scan_config = {
	CONFIG_FILE,
	DAST_SETTING,
	is_scan_enabled,
}

export { scan_config }
