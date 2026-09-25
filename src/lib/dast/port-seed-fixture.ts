import { LANE_SEAT_KEY, PORT_SEED_KEY, ports } from '@joshuafolkken/kit/ports'

// Shared by every suite that exercises the preview port (dast, load, shot, verify, preview-port
// itself). The port's inputs live in process.env, which is global to the worker: a value one test
// sets would pin every later one — kit's loader deliberately lets an existing variable win over
// `.env`, so the leak is silent rather than loud. Each suite therefore clears them before a test
// and puts the originals back after, and this is that ritual in one place instead of five copies.
//
// Test-only, but a plain module rather than a `*.test.ts`: it holds no tests of its own, and it is
// under `src/lib/dast/`, which package.json excludes from the published files.

// Every key kit reads for the offset. `JOSH_LANE_SEAT` joined `PORT_SEED` in kit 1.767.0; isolating
// only the seed would leave the newer key free to pin every suite from a lane's own `.env` — the
// exact leak this fixture exists to close, arriving through the half it did not know about.
const ISOLATED_KEYS: ReadonlyArray<string> = [PORT_SEED_KEY, LANE_SEAT_KEY]

// The historical preview port. Deliberately a literal rather than kit's own resolver run with an
// empty environment: the guarantee being pinned is that an unset seed still means 4173, which a
// value read back from kit could never fail to satisfy.
const BASE_PREVIEW_PORT = 4173

// One is enough to prove the offset is applied: any non-zero seed distinguishes "follows kit" from
// "hardcodes the base".
const TEST_SEED = 1

// Asked of kit rather than computed here. Spelling this out as `BASE_PREVIEW_PORT + TEST_SEED`
// cloned kit's formula, so it went stale in silence the moment kit 1.767.0 changed the offset to
// `seed × 10 + lane` to give each seed a disjoint band. Deriving it is still not tautological for
// the suites that use it: they assert a command hands THIS port to the preview it boots and to the
// scan or scenario it points at that server, so one that hardcodes the base fails exactly as before.
// The environment is passed explicitly, so an ambient seed cannot move the expected value either.
const SEEDED_PREVIEW_PORT = ports.resolve_preview_port({ [PORT_SEED_KEY]: String(TEST_SEED) })

interface SeedIsolation {
	clear: () => void
	restore: () => void
	set: (seed: number) => void
}

// `Reflect.deleteProperty` rather than `delete process.env[key]`: the keys are constants read from
// kit, and a computed `delete` is banned.
function drop_port_keys(): void {
	for (const key of ISOLATED_KEYS) Reflect.deleteProperty(process.env, key)
}

function set_seed(seed: number): void {
	process.env[PORT_SEED_KEY] = String(seed)
}

// Called at a suite's module scope, so the snapshot holds the values the worker started with — no
// test has run yet, and those ambient values are exactly what `restore` has to put back. Reading
// them once here rather than on every `clear` also keeps the fixture free of mutable state.
function isolate(): SeedIsolation {
	const original: Record<string, string | undefined> = {}

	for (const key of ISOLATED_KEYS) original[key] = process.env[key]

	function restore(): void {
		drop_port_keys()

		for (const key of ISOLATED_KEYS) {
			const value = original[key]
			if (value !== undefined) process.env[key] = value
		}
	}

	return { clear: drop_port_keys, restore, set: set_seed }
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
