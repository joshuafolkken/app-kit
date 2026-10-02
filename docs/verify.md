# Unified pre-push gate (`josh-app verify`)

The E2E suite and the [DAST scan](./dast.md) both need the built app running on the preview port. Rather than each building and booting its own preview (duplicate work serially, a port/build collision in parallel), the pre-push hook runs one `josh-app verify` command that **builds once, boots the preview once, then runs Playwright and the ZAP scan against that single server**, and tears it down. Playwright reuses the already-booted server via `PLAYWRIGHT_REUSE_SERVER=1` (kit#673), so it never rebuilds.

## When the scan runs

`verify` receives the pushed file list and keeps the scan narrowly triggered: E2E always runs, but the ~34s ZAP scan runs **only** when a header/cookie-affecting file changed — `_headers`, `src/hooks.server.ts`, `+server.ts` / `+*.server.ts`, `wrangler.jsonc`, `svelte.config.js`, or `zap-baseline.conf`. A baseline scan is passive (it only observes response headers and cookie attributes), so a component or utility change cannot alter its result, and spending ~34s per push on one is how hooks end up bypassed. An empty file list is fail-safe → scan (a security check is never skipped silently).

`package.json` and `pnpm-lock.yaml` are excluded on purpose: a version bump rewrites `package.json` on essentially every commit, so including it would fire the scan every time and undo the narrowing. Dependency-driven header changes are caught by the **nightly** scheduled scan ([dast.md](./dast.md#where-it-runs)), which rebuilds and scans the full app.

## The preview port

That port is not a literal anywhere in app-kit: `verify`, `josh-app dast` and `josh-app load` all resolve it through kit's single definition (`@joshuafolkken/kit/ports`), and the distributed `preview` script resolves it from the same source with `PREVIEW_PORT=$(josh port preview) && …` (pnpm-free and assignment-form, so pnpm's stdout noise never becomes the port argument and a failed resolution stops the server start — kit#825) — which is what lets `PORT_SEED` in your `.env` move the preview, the scan and Playwright together. Unset it and the port is the historical `4173`, exactly as before.

**`dev` is wired the same way, and is fully managed** (app-kit 0.81.0 — before that only `preview` was, so a seeded consumer's Playwright waited on `5173 + PORT_SEED` while its `vite dev` bound `5173`, and no sync could repair it). Two consequences worth knowing before you upgrade:

- **`josh-app sync` overwrites `dev`**, as it does every managed script — it is not seed-only like `_headers`. If you had customized it (a `--host` flag, a pre-step), re-apply that after the sync or move it into a script of your own that sync does not manage.
- **The distributed `dev` passes `--strictPort`**, so a busy port now fails loudly instead of vite silently binding the next free one. That silence is the bug the seed exists to remove: a drifted port is a port Playwright is not waiting on. If you run several kit projects at once, give each one a `PORT_SEED` in its `.env` rather than relying on the drift.

## The port must be free

Before booting, `verify` checks whether anything already answers on the preview port and stops if so, naming the port and the command that identifies the owner. It never adopts a server it did not start: a stranger's preview (or an orphaned `wrangler dev` from an interrupted run) would otherwise satisfy every readiness probe, and both Playwright and the scan would check that application instead of yours — the header findings would then say nothing about this build. A boot that dies before answering also fails immediately with the server's own output, rather than being polled until the two-minute deadline.
