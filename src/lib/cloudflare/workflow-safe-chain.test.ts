import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// ci.yml is kit's, rewritten on every sync; it is the reference the two app-kit workflows follow.
const REFERENCE_WORKFLOW = '.github/workflows/ci.yml'
const APP_KIT_WORKFLOWS = ['.github/workflows/dast.yml', '.github/workflows/load.yml']
const PIN_KEYS = ['SAFE_CHAIN_INSTALLER_VERSION', 'SAFE_CHAIN_INSTALLER_SHA256']
// The "Setup safe-chain" step from its name line through every line indented under it.
const SETUP_STEP_RE = / {6}- name: Setup safe-chain\n(?: {8}.*\n)+/gu
const LEGACY_SETUP = 'setup-ci'

function read_workflow(file: string): string {
	return readFileSync(file, 'utf8')
}

function pin_value(content: string, key: string): string | undefined {
	return new RegExp(String.raw`^ {2}${key}: (?<value>\S+)$`, 'mu').exec(content)?.groups?.['value']
}

function setup_steps(content: string): Array<string> {
	return [...content.matchAll(SETUP_STEP_RE)].map((match) => match[0])
}

const reference = read_workflow(REFERENCE_WORKFLOW)
const [reference_step] = setup_steps(reference)

describe.each(APP_KIT_WORKFLOWS)('safe-chain setup in %s', (file) => {
	const content = read_workflow(file)

	it.each(PIN_KEYS)('pins %s to the same value as ci.yml', (key) => {
		expect(pin_value(reference, key)).toBeDefined()
		expect(pin_value(content, key)).toBe(pin_value(reference, key))
	})

	it('installs safe-chain with the same checked-installer step as ci.yml', () => {
		expect(reference_step).toBeDefined()
		expect(setup_steps(content)).toStrictEqual([reference_step])
	})

	it('no longer calls the legacy setup-ci shim installer', () => {
		expect(content).not.toContain(LEGACY_SETUP)
	})
})
