import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const ENCODING = 'utf8'

// `josh sync` writes playwright.config.ts from a generator, and kit's own package-root copy is
// generated the same way, so the two agree byte for byte and the published file stands in for the
// generator — which kit does not export. A kit release that let its root copy drift from the
// generator would fail this too; the failure is loud and one `josh sync` diagnoses which of the two
// moved. ci.yml is deliberately excluded: it is a mapped file whose action pins are re-resolved at
// write time (kit#747), so the consumer copy legitimately differs from the template it came from.
const PLAYWRIGHT_CONFIG = 'playwright.config.ts'
const KIT_PLAYWRIGHT_CONFIG = path.join('node_modules', '@joshuafolkken', 'kit', PLAYWRIGHT_CONFIG)

function read_file(file_path: string): string {
	return readFileSync(file_path, ENCODING)
}

describe('kit-distributed playwright.config.ts', () => {
	it('matches the installed kit master, so a kit bump without a sync fails here', () => {
		// app-kit kept running kit 1.63.0's config through eleven kit releases, including the one
		// that made local `reuseExistingServer` opt-in (kit#784). Until then the local branch
		// reused whatever already listened on vite's default port, and — baseURL being derived
		// from that port — reported the whole suite green against a foreign application. The
		// stale copy was invisible because nothing compared it to the package it came from: the
		// dependency bump and the sync that must follow it were two steps, and only one had a
		// failing check behind it. See #168.
		expect(read_file(PLAYWRIGHT_CONFIG)).toBe(read_file(KIT_PLAYWRIGHT_CONFIG))
	})
})
