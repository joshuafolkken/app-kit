import { readFileSync } from 'node:fs'
import path from 'node:path'
import { managed_marker_logic } from '@joshuafolkken/kit/managed-marker'
import { describe, expect, it } from 'vitest'
import { cloudflare_sync } from './sync.js'

const ENCODING = 'utf8'
// app-kit's repo root: the package root every managed copy is read from.
const SOURCE_DIR = '.'
const PACKAGE_JSON = 'package.json'
const DAST_WORKFLOW = '.github/workflows/dast.yml'
// Stands in for a consumer project. Never written to and never read — `managed_copy_content` uses
// the destination only to recognize the self-copy — so no directory has to exist for it.
const CONSUMER_DIR = 'consumer-project'
// Read from the manifest rather than spelled out: the overlay stamps whatever name app-kit's own
// package.json carries, so a literal here would drift from it silently on a rename.
const APP_KIT_PACKAGE_NAME = (JSON.parse(readFileSync(PACKAGE_JSON, ENCODING)) as { name: string })
	.name

// #192: kit decides "will a sync overwrite this workflow?" from a stamp on the file itself rather
// than from a closed path list, precisely so a package downstream of kit can answer for its own
// distribution (joshuafolkken/kit#844). app-kit is such a package — it byte-copies dast.yml and
// load.yml into every consumer — and without a stamp a consumer's Dependabot auto-merges a bump to
// one of them, the next `josh-app sync` reverts it, and Dependabot proposes it again: kit#836's
// loop one distribution layer down.
//
// These drive `managed_copy_content` rather than `apply_overlay`, because the case that matters
// most — source and destination being one file — is app-kit's own repository, and running the
// overlay against it really does rewrite .npmrc, tsconfig.json, cspell.config.yaml and lefthook.yml
// in the working tree. A test may not do that, so the decision is exercised where it is made.
// workflow-distribution.test.ts covers the other half: that `apply_overlay` writes what this says.
describe('app-kit stamps the workflows it byte-copies (#192)', () => {
	it('stamps a consumer copy with app-kit own name, not kit name', () => {
		for (const entry of cloudflare_sync.MANAGED_COPY_ENTRIES) {
			const written = cloudflare_sync.managed_copy_content(
				entry,
				path.join(CONSUMER_DIR, entry.dest),
				SOURCE_DIR,
			)
			const header = `${managed_marker_logic.MARKER_PREFIX} ${APP_KIT_PACKAGE_NAME}`

			expect(managed_marker_logic.is_marked(written), entry.dest).toBe(true)
			expect(written.startsWith(header), entry.dest).toBe(true)
		}
	})

	// Every entry, not just one: this is the only assertion left tying a consumer's copy back to the
	// bytes of app-kit's own workflow, so a second managed entry must not be able to lose its body
	// while the first keeps passing.
	it('leaves every workflow body untouched below the stamp', () => {
		for (const entry of cloudflare_sync.MANAGED_COPY_ENTRIES) {
			const written = cloudflare_sync.managed_copy_content(
				entry,
				path.join(CONSUMER_DIR, entry.dest),
				SOURCE_DIR,
			)

			expect(written.endsWith(readFileSync(entry.template, ENCODING)), entry.dest).toBe(true)
		}
	})
})

// The other side of the same decision. app-kit's own repository is the one place these files are
// NOT a distribution: every entry maps a workflow to itself, so applying the overlay here would
// stamp the file app-kit actually runs — telling a reader to edit it in some other package, and
// stopping Dependabot from auto-merging a bump that here nobody upstream maintains.
describe('app-kit leaves its own copy unstamped (#192)', () => {
	it('does not stamp app-kit own copy, where source and destination are one file', () => {
		for (const entry of cloudflare_sync.MANAGED_COPY_ENTRIES) {
			const written = cloudflare_sync.managed_copy_content(entry, entry.dest, SOURCE_DIR)

			expect(written, entry.dest).toBe(readFileSync(entry.template, ENCODING))
			expect(managed_marker_logic.is_marked(written), entry.dest).toBe(false)
		}
	})

	// The guard compares resolved paths, so it has to hold for a destination spelled differently
	// from the entry — which is how `apply_overlay` reaches it, joining the target directory on.
	it('recognizes the self-copy through a non-normalized destination path', () => {
		const noisy = path.join(SOURCE_DIR, '.', DAST_WORKFLOW)
		const written = cloudflare_sync.managed_copy_content(
			{ template: DAST_WORKFLOW, dest: DAST_WORKFLOW },
			noisy,
			SOURCE_DIR,
		)

		expect(managed_marker_logic.is_marked(written)).toBe(false)
	})

	// A drift guard on the real files, not on a computed string. `is_self_copy` compares resolved
	// paths, which answers "am I about to write the file I just read?" — the right question for
	// `pnpm josh-app sync` here and for a consumer install alike, but not one that can see through a
	// GLOBALLY installed josh-app run inside this repository: there the package root is the global
	// copy, the two paths differ, and app-kit's own workflow would be stamped. Making the predicate
	// itself cover that is not worth the complexity, so the accident is caught here instead — a
	// stamped file in this repository fails CI on the next run, whatever route put it there.
	it('keeps app-kit own workflows unstamped on disk', () => {
		for (const entry of cloudflare_sync.MANAGED_COPY_ENTRIES) {
			const own = readFileSync(entry.template, ENCODING)

			expect(managed_marker_logic.is_marked(own), entry.template).toBe(false)
		}
	})

	// The single-source shape is what makes the guard necessary; if an entry ever gained a separate
	// templates/ path, the destination would stop colliding with the source and the case above would
	// be dead code rather than a live protection.
	it('every managed copy still maps a workflow to itself', () => {
		for (const entry of cloudflare_sync.MANAGED_COPY_ENTRIES) {
			expect(entry.template, entry.dest).toBe(entry.dest)
		}
	})
})
