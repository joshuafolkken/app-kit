// The handle the preview lifecycle hands around, in its own file because both the module that
// CREATES it (preview-spawn.ts) and the module that JUDGES it (preview.ts) need the type, and
// importing it from either one would make the two depend on each other.
interface PreviewHandle {
	stop: () => void
	// Everything the server has written so far — shown only when it fails to become ready.
	output: () => string
	// Whether the spawned process is already gone. A wrangler that could not bind exits within
	// milliseconds; without this the readiness loop would poll a dead server for the full timeout.
	has_exited: () => boolean
	// The spawned process group, which `detached: true` makes equal to the child's own pid. The
	// readiness check compares this identity against the listener's group and ancestry, since pnpm
	// may start wrangler and its workerd listener in another group.
	group_id: () => number | undefined
}

export type { PreviewHandle }
