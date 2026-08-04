import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { OverlayChange } from './sync.js'

const ENCODING = 'utf8'

type ContentPatcher = (content: string) => string

// Patch one already-existing consumer file in place, preserving every untouched byte. A file the
// consumer has not created yet is skipped — the orchestrated `josh sync` / `josh init` seeds the
// base first — and an already-correct file is a no-op, so re-runs report `skipped` and never
// rewrite bytes. Shared by the layered config patcher and the seeded k6 scenarios, which apply the
// same "the consumer owns this file; app-kit ensures only its own lines in it" rule.
function patch_file(target: string, file: string, patch: ContentPatcher): OverlayChange {
	const destination = path.join(target, file)
	if (!existsSync(destination)) return { file, action: 'skipped' }

	const original = readFileSync(destination, ENCODING)
	const patched = patch(original)
	if (patched === original) return { file, action: 'skipped' }

	writeFileSync(destination, patched)

	return { file, action: 'updated' }
}

export { patch_file }
export type { ContentPatcher }
