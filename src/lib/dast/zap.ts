// Argv builders for the OWASP ZAP baseline scan. Pure string assembly, kept separate from the
// orchestration in dast.ts so the exact shipped command line is unit-testable without Docker.
const DOCKER_BIN = 'docker'

// `stable` rather than a digest pin: the baseline scan's value is its rule set, and pinning would
// freeze the passive rules at release time — the opposite of what a security scan is for.
const ZAP_IMAGE = 'ghcr.io/zaproxy/zaproxy:stable'
const ZAP_BASELINE_SCRIPT = 'zap-baseline.py'

// The directory zap-baseline.py reads its `-c` config from and writes reports to.
const ZAP_WORK_DIR = '/zap/wrk'
const ZAP_CONFIG_FILE = 'zap-baseline.conf'

// The preview server runs on the host, the scanner inside a container. `host.docker.internal` is
// provided natively by Docker Desktop and mapped explicitly via `host-gateway` for Linux/CI, so
// one argv form works on every platform — no per-OS branch, no `--network host` (unsupported on
// macOS Docker Desktop by default).
const HOST_ALIAS = 'host.docker.internal'
const HOST_GATEWAY_MAPPING = `${HOST_ALIAS}:host-gateway`

// `docker info` talks to the daemon, unlike `docker --version` which only proves the CLI exists.
const PREFLIGHT_ARGV: ReadonlyArray<string> = ['info']

function build_target_url(port: number): string {
	return `http://${HOST_ALIAS}:${String(port)}`
}

// The repo is mounted read-write because zap-baseline.py treats /zap/wrk as its working
// directory. `config_file` is undefined when the project has no baseline config yet — passing a
// `-c` path that does not exist makes ZAP exit 3 (error) instead of reporting findings.
function build_scan_argv(
	cwd: string,
	port: number,
	config_file: string | undefined,
): ReadonlyArray<string> {
	const config_argv = config_file === undefined ? [] : ['-c', config_file]

	return [
		'run',
		'--rm',
		'--add-host',
		HOST_GATEWAY_MAPPING,
		'--volume',
		`${cwd}:${ZAP_WORK_DIR}:rw`,
		ZAP_IMAGE,
		ZAP_BASELINE_SCRIPT,
		'-t',
		build_target_url(port),
		...config_argv,
	]
}

const zap = {
	DOCKER_BIN,
	ZAP_CONFIG_FILE,
	PREFLIGHT_ARGV,
	build_target_url,
	build_scan_argv,
}

export { zap }
