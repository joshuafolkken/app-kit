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
