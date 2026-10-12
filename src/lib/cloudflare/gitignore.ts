import { existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { patch_file } from './patch-file.js'
import type { OverlayChange } from './sync.js'

const GITIGNORE_FILE = '.gitignore'

// What app-kit's own managed scripts generate into a consumer: `prepare:gen` runs `wrangler types`,
// which writes this file at the project root on every install. The lint, format and spell checks all
// read `.gitignore` to decide what to skip, so the entry is what keeps a generated file out of the
// verification gate.
//
// kit's `.gitignore` template carries the same line, but kit writes that file only into a git
// repository — a project `josh-app init` runs in before `git init` gets none of it, and the gate
// fails on the generated file (#290). The script that generates the file is app-kit's, so the entry
// is app-kit's to ensure, with or without a repository.
const GENERATED_ENTRIES: ReadonlyArray<string> = ['/worker-configuration.d.ts']

// Per-line rather than a substring search, so a longer pattern that merely contains an entry never
// counts as that entry. Every existing byte is kept; a file that does not end in a newline gets one
// first, so the appended line is never glued onto the last entry.
function ensure_entries(content: string): string {
	const existing = new Set(content.split('\n').map((line) => line.trim()))
	const missing = GENERATED_ENTRIES.filter((entry) => !existing.has(entry))
	if (missing.length === 0) return content

	const prefix = content.length > 0 && !content.endsWith('\n') ? `${content}\n` : content

	return `${prefix}${missing.join('\n')}\n`
}

// Created when absent rather than skipped: kit's ESLint scaffold reads `./.gitignore`, and a project
// with no repository may have none at all.
function sync_gitignore(target: string): OverlayChange {
	const destination = path.join(target, GITIGNORE_FILE)
	if (existsSync(destination)) return patch_file(target, GITIGNORE_FILE, ensure_entries)

	writeFileSync(destination, ensure_entries(''))

	return { file: GITIGNORE_FILE, action: 'created' }
}

const cloudflare_gitignore = { GITIGNORE_FILE, GENERATED_ENTRIES, ensure_entries, sync_gitignore }

export { cloudflare_gitignore }
