import { spawnSync } from 'node:child_process'
import { createServer } from 'node:net'

// Who holds the preview port, and is it us? Two questions the HTTP readiness probe cannot answer,
// split out of preview.ts because they are about the OS view of a socket rather than the lifecycle
// of a spawned server.
//
// #136 added a pre-spawn HTTP probe: if something already answers on the port, the run stops rather
// than adopting it. That closed the steady-state case but left the window #175 was filed for — the
// probe asks "does something answer", never "whose answer is it", and preview.ts already recorded
// the two gaps that follow from it: "A holder that answers no HTTP at all is out of the pre-check's
// reach", and a holder that appears after the check is never re-examined.
const LOOPBACK_HOST = '127.0.0.1'

// Occupancy, asked of the kernel instead of the application. A process can hold a listening socket
// while answering nothing an HTTP client would recognize — an orphaned `workerd` mid-teardown is
// exactly that — and such a holder passes the HTTP probe untouched, then answers again once it is
// too late to matter.
//
// The bind is loopback-SPECIFIC on purpose. preview.ts rejects "a bind check" in its comments, and
// correctly so for the check it had in mind: PREVIEW_ARGV binds `0.0.0.0`, and on macOS that does
// NOT collide with a loopback-only listener, so test-binding the wildcard would have missed the very
// squatter #136 was about. Naming 127.0.0.1 inverts that — a loopback-only holder is precisely what
// collides here, and loopback is where every readiness probe lands.
//
// The converse (a holder bound to the wildcard) is not guaranteed to collide on BSD, so this does
// not replace the HTTP probe; the two cover different holders and both run.
type FreeResolver = (is_free: boolean) => void

function begin_free_probe(port: number, resolve: FreeResolver): void {
	const server = createServer()

	function on_error(): void {
		resolve(false)
	}

	function on_close(): void {
		resolve(true)
	}

	function on_listening(): void {
		server.close(on_close)
	}

	server.once('error', on_error)
	server.once('listening', on_listening)
	server.listen({ host: LOOPBACK_HOST, port, exclusive: true })
}

async function is_port_free(port: number): Promise<boolean> {
	return await new Promise<boolean>(function probe(resolve: FreeResolver): void {
		begin_free_probe(port, resolve)
	})
}

// 'unknown' is NOT a synonym for 'foreign'. It means the lookup itself could not run — `lsof` absent,
// or restricted — which is a statement about the machine, not about the server. Reporting it
// separately is what lets the caller decide, rather than having this module silently pick either
// "trust it" or "fail the run" on its behalf.
type Ownership = 'owned' | 'foreign' | 'unknown'

const LSOF_COMMAND = 'lsof'

// `-t` prints bare PIDs and nothing else, which is the whole parse. Everything before it is shared
// with the hint printed to the user, and shared as CODE rather than as a matching pair of strings:
// the flags decide which sockets the lookup sees, so a hint that drifted from them would send the
// reader after a different set of processes than the one this module just judged.
function build_lookup_flags(port: number): ReadonlyArray<string> {
	return ['-nP', `-iTCP:${String(port)}`, '-sTCP:LISTEN']
}

const TERSE_FLAG = '-t'

function build_lsof_argv(port: number): ReadonlyArray<string> {
	return [...build_lookup_flags(port), TERSE_FLAG]
}

// `undefined` covers both "the tool is not here" (spawn error) and "it found nothing" (non-zero
// exit). Neither is evidence about ownership, and collapsing them keeps the caller from having to
// distinguish two shapes of the same non-answer.
function read_command(command: string, argv: ReadonlyArray<string>): string | undefined {
	const result = spawnSync(command, [...argv], { encoding: 'utf8' })
	if (result.error !== undefined) return undefined
	if (result.status !== 0) return undefined

	return result.stdout
}

function to_number(line: string): number {
	return Number(line.trim())
}

function is_process_id(value: number): boolean {
	return Number.isSafeInteger(value) && value > 0
}

// Serves both lookups: `lsof -t` and `ps -o pgid=` each emit one integer per line, the latter
// space-padded, which the trim absorbs.
function parse_ids(output: string): ReadonlyArray<number> {
	return output
		.split('\n')
		.map((line: string) => to_number(line))
		.filter((value: number) => is_process_id(value))
}

function to_ps_selector(pid: number): ReadonlyArray<string> {
	return ['-p', String(pid)]
}

function read_group_ids(pids: ReadonlyArray<number>): ReadonlyArray<number> {
	const selectors = pids.flatMap((pid: number) => to_ps_selector(pid))
	const output = read_command('ps', ['-o', 'pgid=', ...selectors])
	if (output === undefined) return []

	return parse_ids(output)
}

// The listener is rarely the process we spawned: `wrangler dev` runs its own `workerd` child, and it
// is that child holding the socket. Comparing process GROUPS rather than PIDs is what makes the
// descendant count as ours — the same reason teardown signals the group (`-pid`) instead of the
// child.
function resolve_listener_group_ids(port: number): ReadonlyArray<number> {
	const listeners = read_command(LSOF_COMMAND, build_lsof_argv(port))
	if (listeners === undefined) return []

	const pids = parse_ids(listeners)
	if (pids.length === 0) return []

	return read_group_ids(pids)
}

// Kept separate from the lookup so the decision can be exercised without a live socket: an empty
// list is the "could not ask" case, never the "nobody is there" case, and conflating the two is the
// mistake that would hand a foreign server a clean bill of health.
function decide_ownership(group_ids: ReadonlyArray<number>, group_id: number): Ownership {
	if (group_ids.length === 0) return 'unknown'

	return group_ids.includes(group_id) ? 'owned' : 'foreign'
}

function check_ownership(port: number, group_id: number): Ownership {
	return decide_ownership(resolve_listener_group_ids(port), group_id)
}

// Names the port and how to find its owner: the whole failure is "something else is on 4173", and a
// message that does not say which process to look for just moves the guessing to the reader. The
// cleanup names the PID that lookup returns rather than a process-name kill: the likely owner is
// ANOTHER project's preview (that is the incident behind #136), so `pkill -f 'wrangler dev'` would
// take out the very server someone else is working against.
function build_lookup_hint(port: number): ReadonlyArray<string> {
	const lookup = [LSOF_COMMAND, ...build_lookup_flags(port)].join(' ')

	return [
		`Find the owner with: ${lookup}`,
		`Then stop that PID (kill <pid>) — it may be another project's preview, or an orphan from an interrupted run.`,
	]
}

function build_occupied_message(url: string, port: number): string {
	return [
		`Preview port ${String(port)} already answers at ${url}, so it is held by a server josh-app did not start.`,
		`Reusing it would check that application instead of this one, so the run stops here.`,
		...build_lookup_hint(port),
	].join('\n')
}

// The silent holder the HTTP probe cannot see. Worth its own wording: "nothing answers but the port
// is taken" reads as a contradiction, and a reader who has just been told the port is free by curl
// needs to know the check was made against the kernel, not the application.
function build_held_message(port: number): string {
	const number = String(port)

	return [
		`Preview port ${number} is already held by another process, even though nothing answers HTTP there.`,
		`A server mid-shutdown still owns its socket and can start answering again, which would point this run at it.`,
		...build_lookup_hint(port),
	].join('\n')
}

// Reached only when the port was free before the spawn and something else took loopback afterwards.
// Rare, and stated as such: a message that reads like the ordinary occupied case would send the
// reader looking for the wrong thing.
function build_foreign_message(url: string, port: number): string {
	return [
		`The server answering at ${url} is not the one josh-app started.`,
		`Port ${String(port)} was free at startup, so another process claimed it while this run was booting.`,
		...build_lookup_hint(port),
	].join('\n')
}

// Not a failure — a downgrade of confidence, and it says which one. Without `lsof` the run keeps the
// guarantee the pre-spawn checks gave it (the port was free when the server was started) and loses
// only the mid-boot theft case above.
function build_unverified_message(port: number): string {
	return [
		`Could not confirm which process is listening on port ${String(port)} — \`${LSOF_COMMAND}\` is unavailable here.`,
		`Continuing: the port was verified free before the server was started, so only a mid-boot takeover would go unnoticed.`,
	].join('\n')
}

const port_owner = {
	LOOPBACK_HOST,
	build_lookup_flags,
	build_lsof_argv,
	build_occupied_message,
	build_held_message,
	build_foreign_message,
	build_unverified_message,
	check_ownership,
	decide_ownership,
	is_port_free,
	parse_ids,
}

export { port_owner }
export type { Ownership }
