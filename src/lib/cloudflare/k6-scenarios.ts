// The k6 load-test scenarios (`josh-app load`) are `.js` files that live at the project root, so a
// consumer whose tsconfig carries the legacy SvelteKit `include: ["./**/*.js", ...]` type-checks
// them with `checkJs` — and they cannot pass: they target k6's own JS runtime, where the `k6` /
// `k6/http` module specifiers and the `__ENV` global exist but TypeScript cannot resolve them
// (app-kit#109). The scenarios are seeded once and then owned by the consumer, so the fix travels
// with the file rather than with a tsconfig edit: the directive below is the file declaring itself
// out of the app's type-check, mirroring the `ignores: ['k6/**']` the app-kit ESLint preset already
// applies for the identical reason.
//
// Not a tsconfig `exclude` entry: `exclude` does not merge across `extends`, so writing one into a
// consumer that has none (the shape `josh init` generates) would discard both the `exclude`
// inherited from `.svelte-kit/tsconfig.json` and TypeScript's default `node_modules` exclusion —
// causing the same class of breakage this fixes.
const TS_NOCHECK_DIRECTIVE = '// @ts-nocheck'

const TS_NOCHECK_HEADER = `${TS_NOCHECK_DIRECTIVE}
// k6 scenarios run in k6's own JS runtime, not Node or the browser: the \`k6\` / \`k6/http\` module
// specifiers and the \`__ENV\` global cannot resolve under the app's tsconfig, which type-checks
// \`**/*.js\` with \`checkJs\`. The directive above keeps \`tsc --noEmit\` off this file — the app-kit
// ESLint preset ignores \`k6/**\` for the same reason. Remove it only if you add \`@types/k6\`.
`

const LINE_COMMENT = '//'

function is_code_line(line: string): boolean {
	const trimmed = line.trimStart()

	return trimmed.length > 0 && !trimmed.startsWith(LINE_COMMENT)
}

// TypeScript honours `@ts-nocheck` only in the comment block preceding the first statement, so a
// stray mention further down the file — a consumer note about having removed it, say — does not
// exempt the file. Look where the compiler looks: scan the leading comments, stop at the first
// line of code. Matching the whole file instead would report `skipped` while `tsc` still fails.
const NOT_FOUND = -1

function has_leading_directive(content: string): boolean {
	const lines = content.split('\n')
	const first_code = lines.findIndex((line) => is_code_line(line))
	const leading = first_code === NOT_FOUND ? lines : lines.slice(0, first_code)

	return leading.some((line) => line.trimStart().startsWith(TS_NOCHECK_DIRECTIVE))
}

// Ensure a k6 scenario declares itself out of the app's type-check. The consumer's own tuning is
// preserved verbatim — only the header is prepended, and only when the directive is absent, so
// re-running is a no-op and a scenario seeded from the (already-annotated) template is untouched.
function ensure_ts_nocheck(content: string): string {
	if (has_leading_directive(content)) return content

	return `${TS_NOCHECK_HEADER}${content}`
}

const k6_scenarios = { TS_NOCHECK_DIRECTIVE, TS_NOCHECK_HEADER, ensure_ts_nocheck }

export { k6_scenarios }
