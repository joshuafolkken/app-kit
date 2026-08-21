import { PORT_SEED_KEY } from '@joshuafolkken/kit/ports'

// Shared by every suite that exercises the preview port (dast, load, verify, preview-port itself).
// `PORT_SEED` lives in process.env, which is global to the worker: a seed one test sets would pin
// every later one — kit's loader deliberately lets an existing variable win over `.env`, so the
// leak is silent rather than loud. Each suite therefore clears it before a test and puts the
// original back after, and this is that ritual in one place instead of four copies.
//
// Test-only, but a plain module rather than a `*.test.ts`: it holds no tests of its own, and it is
// under `src/lib/dast/`, which package.json excludes from the published files.

// The historical preview port. Deliberately a literal rather than kit's own resolver run with an
// empty environment: the guarantee being pinned is that an unset seed still means 4173, which a
// value read back from kit could never fail to satisfy.
const BASE_PREVIEW_PORT = 4173

// One is enough to prove the offset is applied: any non-zero seed distinguishes "follows kit" from
// "hardcodes the base".
const TEST_SEED = 1
const SEEDED_PREVIEW_PORT = BASE_PREVIEW_PORT + TEST_SEED

interface SeedIsolation {
	clear: () => void
	restore: () => void
	set: (seed: number) => void
}

// `Reflect.deleteProperty` rather than `delete process.env[KEY]`: the key is a constant read from
// kit, and a computed `delete` is banned.
function drop_seed(): void {
	Reflect.deleteProperty(process.env, PORT_SEED_KEY)
}

function set_seed(seed: number): void {
	process.env[PORT_SEED_KEY] = String(seed)
}

// Called at a suite's module scope, so the snapshot is the value the worker started with — no test
// has run yet, and that ambient value is exactly what `restore` has to put back. Reading it once
// here rather than on every `clear` also keeps the fixture free of mutable state.
function isolate(): SeedIsolation {
	const original = process.env[PORT_SEED_KEY]

	function restore(): void {
		drop_seed()
		if (original !== undefined) process.env[PORT_SEED_KEY] = original
	}

	return { clear: drop_seed, restore, set: set_seed }
}

const port_seed_fixture = {
	PORT_SEED_KEY,
	BASE_PREVIEW_PORT,
	TEST_SEED,
	SEEDED_PREVIEW_PORT,
	isolate,
}

export { port_seed_fixture }
export type { SeedIsolation }
