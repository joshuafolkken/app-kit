import { ESLint } from 'eslint'
import { expect, it } from 'vitest'

const RESTRICTED_SYNTAX = 'no-restricted-syntax'
const SPEC_BAN = 'Rename this file'
const CENTRALIZED_BAN = 'A top-level tests/ directory is forbidden'
const FOR_IN_BAN = 'for..in'
const SYNTAX_SAMPLE = 'for (const key in {}) {}'
const ESLINT_LINT_TIMEOUT_MS = 15_000
const eslint = new ESLint({ cwd: process.cwd() })

const CASES = [
	{ file_path: 'src/lib/invalid.spec.ts', ban_message: SPEC_BAN },
	{ file_path: 'src/routes/+page.spec.ts', ban_message: SPEC_BAN },
	{ file_path: 'tests/invalid.ts', ban_message: CENTRALIZED_BAN },
]

it.each(CASES)(
	'keeps shared syntax restrictions in $file_path',
	async ({ file_path, ban_message }) => {
		const [result] = await eslint.lintText(SYNTAX_SAMPLE, { filePath: file_path })
		const messages = result?.messages
			.filter(function is_restricted(message) {
				return message.ruleId === RESTRICTED_SYNTAX
			})
			.map(function get_message(message) {
				return message.message
			})

		expect(
			messages?.some(function has_ban(message) {
				return message.includes(ban_message)
			}),
		).toBe(true)
		expect(
			messages?.some(function has_syntax(message) {
				return message.includes(FOR_IN_BAN)
			}),
		).toBe(true)
	},
	ESLINT_LINT_TIMEOUT_MS,
)

const PROPS_GUARD_PATH = 'src/lib/lint-guards/PropsConstGuard.svelte'
const SVELTE_PREFER_CONST = 'svelte/prefer-const'
const PREFER_CONST_RULES = new Set(['prefer-const', SVELTE_PREFER_CONST])
const LABEL_MARKUP = '<span>{label}</span>'

function svelte_component(script: string): string {
	return `<script lang="ts">\n\t${script}\n</script>\n\n${LABEL_MARKUP}\n`
}

async function prefer_const_rule_ids(script: string): Promise<Array<string | null>> {
	const [result] = await eslint.lintText(svelte_component(script), { filePath: PROPS_GUARD_PATH })

	return (result?.messages ?? [])
		.filter(function is_prefer_const(message) {
			return message.ruleId !== null && PREFER_CONST_RULES.has(message.ruleId)
		})
		.map(function get_rule_id(message) {
			return message.ruleId
		})
}

it(
	'allows a let binding from $props in Svelte source',
	async () => {
		await expect(
			prefer_const_rule_ids('let { label }: { label: string } = $props()'),
		).resolves.toStrictEqual([])
	},
	ESLINT_LINT_TIMEOUT_MS,
)

it(
	'flags a never-reassigned plain let in Svelte source with svelte/prefer-const',
	async () => {
		await expect(prefer_const_rule_ids("let label = 'x'")).resolves.toStrictEqual([
			SVELTE_PREFER_CONST,
		])
	},
	ESLINT_LINT_TIMEOUT_MS,
)

it(
	'keeps the spec ban after the parameter syntax relaxation',
	async () => {
		const [result] = await eslint.lintText(SYNTAX_SAMPLE, {
			filePath: 'src/params/matcher.spec.ts',
		})
		const messages = result?.messages.filter(function is_restricted(message) {
			return message.ruleId === RESTRICTED_SYNTAX
		})

		expect(
			messages?.some(function has_ban(message) {
				return message.message.includes(SPEC_BAN)
			}),
		).toBe(true)
	},
	ESLINT_LINT_TIMEOUT_MS,
)
