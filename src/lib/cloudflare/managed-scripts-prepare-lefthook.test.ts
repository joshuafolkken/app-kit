import { execFileSync } from 'node:child_process'
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { managed_scripts } from './managed-scripts.js'

const MANIFEST = 'package.json'
const SHELL = '/bin/sh'
const GIT = '/usr/bin/git'
const TEMPORARY_PREFIX = path.join(tmpdir(), 'app-kit-prepare-lefthook-')
const MARKER = 'lefthook-installed'
const EXECUTABLE_MODE = 0o755
const NO_CI = ''
const SKIP_NOTICE = 'run: pnpm prepare'
const NOT_A_REPOSITORY = 'not a git repository'
const DUBIOUS_OWNERSHIP = 'dubious ownership'
const NO_OVERRIDES: Record<string, string> = {}
// Makes git refuse a work tree it does not own, with no user-level `safe.directory` to waive it.
const UNTRUSTED_WORK_TREE: Record<string, string> = {
	GIT_TEST_ASSUME_DIFFERENT_OWNER: '1',
	GIT_CONFIG_GLOBAL: '/dev/null',
	GIT_CONFIG_SYSTEM: '/dev/null',
}
// Folds stderr into the captured output, so what git says beside the notice is asserted too.
const MERGE_STDERR = 'exec 2>&1\n'
const UTF8 = 'utf8'

// Stands in for the real binary with the one trait #289 turns on: `lefthook install` exits
// non-zero outside a Git work tree (`Error: exit status 128` on 1.10.10) and installs inside one.
const FAKE_LEFTHOOK = `#!/bin/sh
git rev-parse --show-toplevel >/dev/null 2>&1 || exit 1
: > ${MARKER}
`

const state = { root: '', project: '' }

function create_project(): void {
	state.root = realpathSync(mkdtempSync(TEMPORARY_PREFIX))
	state.project = path.join(state.root, 'project')
	const bin = path.join(state.root, 'bin')
	const lefthook = path.join(bin, 'lefthook')

	mkdirSync(state.project)
	mkdirSync(bin)
	writeFileSync(lefthook, FAKE_LEFTHOOK)
	chmodSync(lefthook, EXECUTABLE_MODE)
}

// The ceiling keeps git from discovering a repository above the temporary directory, and the
// cleared GIT_DIR / GIT_WORK_TREE keep a git hook that runs this suite from lending it one.
function script_environment(ci: string): NodeJS.ProcessEnv {
	return {
		...process.env,
		PATH: `${path.join(state.root, 'bin')}${path.delimiter}${process.env['PATH'] ?? ''}`,
		CI: ci,
		GIT_CEILING_DIRECTORIES: state.root,
		GIT_DIR: undefined,
		GIT_WORK_TREE: undefined,
	}
}

function remove_project(): void {
	rmSync(state.root, { recursive: true, force: true })
}

function run_git_init(...flags: Array<string>): void {
	execFileSync(GIT, ['init', '--quiet', ...flags], {
		cwd: state.project,
		env: script_environment(NO_CI),
	})
}

interface PrepareResult {
	is_installed: boolean
	output: string
}

// execFileSync throws on a non-zero exit, so returning at all is the exit-code-0 assertion.
function run_prepare_lefthook(
	ci: string,
	overrides: Record<string, string> = NO_OVERRIDES,
): PrepareResult {
	const script = managed_scripts.read_canonical_scripts(MANIFEST)['prepare:lefthook']
	const output = execFileSync(SHELL, ['-c', `${MERGE_STDERR}${script}`], {
		cwd: state.project,
		env: { ...script_environment(ci), ...overrides },
		encoding: UTF8,
	})

	return { is_installed: existsSync(path.join(state.project, MARKER)), output }
}

// #289: `josh-app init` runs `pnpm install` on a scaffolded project that has no Git repository
// yet, and `prepare` must finish there even when a machine-wide lefthook is on PATH.
describe('prepare:lefthook installs hooks only inside a Git repository', () => {
	beforeEach(create_project)

	afterEach(remove_project)

	it('succeeds without installing outside a Git repository', () => {
		expect(run_prepare_lefthook(NO_CI).is_installed).toBe(false)
	})

	it('names the command that sets the hooks when it skips outside a Git repository', () => {
		expect(run_prepare_lefthook(NO_CI).output).toContain(SKIP_NOTICE)
	})

	it('skips with the same notice in a bare repository, which has no work tree', () => {
		run_git_init('--bare')

		const result = run_prepare_lefthook(NO_CI)

		expect(result.is_installed).toBe(false)
		expect(result.output).toContain(SKIP_NOTICE)
	})

	it('installs the hooks inside a Git repository without the skip notice', () => {
		run_git_init()

		expect(run_prepare_lefthook(NO_CI)).toEqual({ is_installed: true, output: '' })
	})

	it('skips the install in CI even inside a Git repository', () => {
		run_git_init()

		expect(run_prepare_lefthook('true').is_installed).toBe(false)
	})
})

// "Not a repository" is only one reason git refuses, and the cure for the others is not `git init`,
// so the skip leaves git's own reason on screen instead of naming a cause itself.
describe('prepare:lefthook shows the reason git gives when it skips', () => {
	beforeEach(create_project)
	afterEach(remove_project)

	it('shows it outside a Git repository', () => {
		expect(run_prepare_lefthook(NO_CI).output).toContain(NOT_A_REPOSITORY)
	})

	it('shows it, and still skips, in a work tree git does not trust', () => {
		run_git_init()

		const result = run_prepare_lefthook(NO_CI, UNTRUSTED_WORK_TREE)

		expect(result.is_installed).toBe(false)
		expect(result.output).toContain(DUBIOUS_OWNERSHIP)
		expect(result.output).toContain(SKIP_NOTICE)
	})
})
