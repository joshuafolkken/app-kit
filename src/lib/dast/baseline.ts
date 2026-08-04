// Single source of the distributable ZAP baseline triage (app-kit#111). The one physical master is
// the repo-root zap-baseline.conf — the very file app-kit runs `josh-app dast` against — following
// the same "app-kit distributes what it runs" rule the k6 scenarios use. There is no separate
// templates/ copy and no rule constant: both the consumer seed and the insert-if-absent merge are
// derived from that file at sync time, so a Tier-1 rule is authored exactly once.
//
// The file is split by APP_KIT_ONLY_MARKER: everything above it is the distributable baseline;
// everything below is app-kit's own demo-only self-triage, stripped before a consumer ever sees it
// (so a demo-specific rule can never leak via the seed or the merge). Three tiers classify every
// finding (documented in the .conf header):
//   Tier 1 — universal: active rule lines. Seeded to fresh consumers and merged into existing ones.
//   Tier 2 — conditional-common: shipped commented-out; the consumer uncomments the choice it made.
//   Tier 3 — instance-unique: not shipped — the consumer authors these locally.

const NEWLINE = '\n'
const COMMENT_PREFIX = '#'
const NOT_FOUND = -1

// The delimiter separating app-kit's distributable baseline (above) from app-kit's own demo-only
// self-triage (below). Load-bearing: the seed strips everything from this line onward.
const APP_KIT_ONLY_MARKER = '# --- app-kit-only ---'

// Prefixes the rules the merge appends to an already-seeded consumer file, so an inserted line is
// auditable as app-kit's and is not mistaken for the consumer's own triage.
const MERGE_MARKER =
	'# --- app-kit universal baseline (inserted by josh-app sync — keep the rule, edit the reason freely) ---'

// A rule line starts at column 0 with its numeric id (`10055\tIGNORE\t(...)`); comments open with
// `#`, blank lines are empty. So a leading digit uniquely marks an active (uncommented) rule.
function is_active_rule_line(line: string): boolean {
	return /^\d/u.test(line)
}

// The rule id a line refers to, ignoring a leading `#` so a commented-out rule (or an explanatory
// comment opening with the id) still counts as "the consumer has a line for this id". Returns
// undefined for prose whose first token is not numeric.
function rule_id_of(line: string): string | undefined {
	const [token] = line.replace(COMMENT_PREFIX, ' ').trim().split(/\s+/u, 1)
	if (token === undefined) return undefined

	return /^\d+$/u.test(token) ? token : undefined
}

// A blank or bare-`#` line — the separators that pad the section boundary and should not trail the
// stripped seed.
function is_separator_line(line: string): boolean {
	const trimmed = line.trim()

	return trimmed === '' || trimmed === COMMENT_PREFIX
}

// The consumer-facing slice of the baseline: everything above APP_KIT_ONLY_MARKER, with trailing
// separator lines trimmed so the seeded file ends cleanly. A file without the marker (a consumer's
// own) is returned unchanged.
function distributable(content: string): string {
	const lines = content.split(NEWLINE)
	const marker = lines.findIndex((line) => line.startsWith(APP_KIT_ONLY_MARKER))
	if (marker === NOT_FOUND) return content

	let end = marker
	while (end > 0 && is_separator_line(lines[end - 1] ?? '')) end -= 1

	return `${lines.slice(0, end).join(NEWLINE)}${NEWLINE}`
}

// The active rule lines a merge propagates — i.e. the distributable Tier-1 rules. Tier-2 lines are
// commented and Tier-3 is consumer-authored, so neither is returned.
function active_rule_lines(content: string): ReadonlyArray<string> {
	return distributable(content)
		.split(NEWLINE)
		.filter((line) => is_active_rule_line(line))
}

function collect_present_ids(content: string): Set<string> {
	const ids = new Set<string>()

	for (const line of content.split(NEWLINE)) {
		const id = rule_id_of(line)
		if (id !== undefined) ids.add(id)
	}

	return ids
}

// Insert-if-absent merge of the universal Tier-1 rules (parsed from `source`, app-kit's master
// baseline) into an existing consumer file. Insert-only: a rule id the consumer already has —
// active OR deliberately commented out — is never touched, so a consumer's own reason and any
// intentional opt-out survive. Appending keeps every other byte intact, and because a re-run finds
// the ids present it is a no-op, so the overlay reports `skipped`.
function ensure_baseline_rules(consumer: string, source: string): string {
	const present = collect_present_ids(consumer)
	const missing = active_rule_lines(source).filter((line) => !present.has(rule_id_of(line) ?? ''))
	if (missing.length === 0) return consumer

	const separator = consumer === '' || consumer.endsWith(NEWLINE) ? '' : NEWLINE

	return `${consumer}${separator}${MERGE_MARKER}${NEWLINE}${missing.join(NEWLINE)}${NEWLINE}`
}

const baseline = {
	APP_KIT_ONLY_MARKER,
	MERGE_MARKER,
	distributable,
	active_rule_lines,
	ensure_baseline_rules,
}

export { baseline }
