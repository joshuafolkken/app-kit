# @joshuafolkken/app-kit

The SvelteKit layer on top of [`@joshuafolkken/kit`](https://github.com/joshuafolkken/kit): a modular runtime feature kit (auth, theme, i18n) plus a toolchain CLI that scaffolds and maintains the SvelteKit + Cloudflare project setup. Runtime features are tree-shakeable via subpath exports.

Like the base kit, app-kit has two roles:

- **`josh-app` CLI** — scaffold (`init`) and re-sync (`sync`) the SvelteKit + Cloudflare overlay, run SvelteKit type-checks (`check`), and manage versions — installed globally, run from any project directory.
- **Feature + config package** — runtime feature modules (`./theme`, `./i18n`) and SvelteKit config presets (ESLint / tsconfig / cspell) consumed as a devDependency.

`josh-app` orchestrates kit's framework-agnostic base first (`josh init` / `josh sync`), then applies the SvelteKit + Cloudflare overlay on top — one command delivers base + overlay.

## Prerequisites

- [Node.js](https://nodejs.org/) with [pnpm](https://pnpm.io/)
- [gh CLI](https://cli.github.com/) — required for GitHub Packages authentication. Install via `brew install gh` (macOS), `winget install GitHub.cli` (Windows), or see the [gh installation docs](https://github.com/cli/cli#installation).
- **GitHub Packages auth.** app-kit is published to the GitHub Packages registry, so a one-time auth setup is required:
  - `~/.npmrc` (user-level) contains:
    ```
    @joshuafolkken:registry=https://npm.pkg.github.com
    //npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
    ```
  - `NODE_AUTH_TOKEN` is set to a GitHub PAT with the `read:packages` scope (the same token used for other `@joshuafolkken/*` packages). Without it, install fails with `ERR_PNPM_FETCH_401`.

## Global install (CLI)

```bash
pnpm add -g @joshuafolkken/app-kit   # install the josh-app CLI globally
josh-app init                        # scaffold base + SvelteKit/Cloudflare overlay
```

> **Version-age gotcha.** A supply-chain safety delay (`minimum-release-age`, 24h) can resolve a bare `pnpm add -g @joshuafolkken/app-kit` to an **older** published version. While the version you want is still inside its 24h window, pin it and skip the age gate:
>
> ```bash
> pnpm add -g @joshuafolkken/app-kit@<version> --safe-chain-skip-minimum-package-age
> ```
>
> Once the target version ages past 24h, a bare `pnpm add -g @joshuafolkken/app-kit` resolves to the latest.

`josh-app init` wires app-kit's presets into the scaffolded `eslint.config.js` / `tsconfig.json` / cspell / lefthook config. For those imports to resolve, add app-kit to the project's `devDependencies` too — this is separate from the global CLI install:

```bash
pnpm add -D @joshuafolkken/app-kit
```

## CLI commands

Run from the root of a SvelteKit project:

| Command                           | What it does                                                               |
| --------------------------------- | -------------------------------------------------------------------------- |
| `josh-app init`                   | Apply kit's base then the SvelteKit + Cloudflare overlay to a project      |
| `josh-app sync`                   | Re-sync the overlay (scripts, seeds, SvelteKit config lines) idempotently  |
| `josh-app check`                  | Fast incremental SvelteKit type-check (dev loop)                           |
| `josh-app check:ci`               | Strict SvelteKit type-check (CI variant)                                   |
| `josh-app dast`                   | Dynamic baseline security scan against the running preview server          |
| `josh-app load`                   | Manual k6 load test against the running preview server (report-only)       |
| `josh-app load:stress`            | Manual k6 stress test — drives load to find the throughput ceiling         |
| `josh-app verify`                 | Unified pre-push gate: build once, boot once, run E2E + DAST scan together |
| `josh-app version` / `v`          | Report installed-vs-latest version                                         |
| `josh-app version:upgrade` / `vu` | Upgrade to the latest version                                              |

`josh-app v` also reports the **effective kit** — the `@joshuafolkken/kit` copy the running CLI
actually executes. kit is an auto-installed peer of the global app-kit, and pnpm resolves that peer
once and pins it in the global install's own lockfile, so a plain `pnpm add -g @joshuafolkken/app-kit`
cannot move it. When the effective kit is stale, `vu` therefore reinstalls the global CLI to force a
fresh resolution:

```bash
pnpm remove -g @joshuafolkken/app-kit; pnpm add -g @joshuafolkken/app-kit@<version>
```

The two commands are separated by `;` rather than `&&` on purpose: if the reinstall fails, running
the same line again still repairs the install. The release-age gate above applies here too — a fresh
resolution picks the newest version older than the delay window, so `v` can still show `⚠` right
after a successful `vu`; the outcome line printed by `vu` reports how far the effective kit advanced.

## Security scanning (DAST)

The static layers inherited from kit (CodeQL, SonarCloud, OSV-Scanner, secretlint) never start
the app. `josh-app dast` closes that gap: it builds the project, boots the preview server, runs
the [OWASP ZAP](https://www.zaproxy.org/) baseline scan against it, and tears the server down —
including on failure. The scan is passive (no attack traffic), so it is safe against a local
preview. It catches the class static analysis structurally cannot see: missing security headers,
unset or weak CSP, and `Secure` / `HttpOnly` / `SameSite` gaps on cookies.

It runs in three places, all sharing one implementation:

| Where          | How                                                                      |
| -------------- | ------------------------------------------------------------------------ |
| Manually       | `pnpm josh-app dast` (local) or the Actions **Run workflow** button (CI) |
| Before a push  | Inside `josh-app verify` — the unified pre-push gate (see below)         |
| CI (scheduled) | `.github/workflows/dast.yml` runs the full scan **nightly**, not per-PR  |

**Why nightly, not per-PR.** The ZAP baseline needs the full ~2.2 GB `zaproxy` image, which
ephemeral CI runners re-pull on every run. Paying that on every PR is wasteful — and since
`dast.yml` is a distributed default, it would land on every consumer's CI. The per-PR value (the
security-header findings the scan reports) is already covered by the Docker-free E2E assertions in
`src/routes/security-headers.e2e.ts`, which `josh-app sync` seeds into your project (see below), so
the full scan only needs to run **nightly** as the broad safety net.
Trigger it on demand anytime via the Actions "Run workflow" button (`workflow_dispatch`) or locally
with `pnpm josh-app dast`. A failed scheduled run is surfaced by GitHub (email + a red run in the
Actions tab) and never blocks a PR.

### The per-PR net (`security-headers.e2e.ts`)

`josh-app sync` seeds `src/routes/security-headers.e2e.ts` once, then it is yours. It runs in the
normal E2E job — no Docker, a few seconds — and asserts the stack-universal half of the contract:

- every header of the baseline is served on a rendered page (derived from `SECURITY_HEADERS`, so a
  header added upstream starts being checked without you touching the file)
- the `Content-Security-Policy` header is present, `script-src` carries a per-request nonce and no
  `'unsafe-inline'`, and `style-src` keeps `'unsafe-inline'` for Svelte transition styles
- the page renders with **zero** `securitypolicyviolation` events — the half that proves the policy
  admits what the app legitimately needs, not just that it blocks things

The checks themselves live in app-kit and are imported, not copied. Each **reports** the departures
it finds rather than asserting internally, so the `expect` stays in your spec where the linter — and
the next reader — can see it:

```ts
import { security_headers_e2e } from '@joshuafolkken/app-kit/security/e2e'

const response = await page.goto('/')

expect(security_headers_e2e.baseline_problems(response)).toStrictEqual([])
expect(security_headers_e2e.csp_problems(response)).toStrictEqual([])
```

A failure prints every departure at once (`script-src is not nonce-based: 'self' 'unsafe-inline'`),
not just the first one.

Extend the seeded file with what only your project knows — the third-party origins your policy
allowlists, a route carrying an embed, proof that a site-specific inline bootstrap executed. A
re-sync never overwrites it.

**When it runs.** `_headers` is applied by the Worker runtime (`pnpm run preview` and production),
never by the vite dev server, so the spec skips on a dev-server run rather than reporting a false
failure. It decides which one it is by asking the running server — the vite HMR client path answers
with JavaScript on dev and 404s on a built app — so there is **no port for you to keep in step**, and
moving your preview port cannot quietly disable the net. Anything inconclusive (no base URL, an
unreachable origin, an answer that is not the client script) runs the assertions: a security check
must never be skipped silently.

Already seeded before app-kit 0.57.0? Your copy still compares `baseURL` against a hardcoded
`'4173'` and goes uncovered if that port ever changes. Replace the two `test.skip(...)` lines with one
hook to pick up the port-free decision:

```ts
test.beforeEach(async ({ page, baseURL: base_url }) => {
	test.skip(
		await security_headers_e2e.is_development_server(page.request, base_url),
		security_headers_e2e.DEV_SERVER_REASON,
	)
})
```

### Unified pre-push gate (`josh-app verify`)

The E2E suite and the DAST scan both need the built app running on port 4173. Rather than each
building and booting its own preview (duplicate work serially, a port/build collision in
parallel), the pre-push hook runs one `josh-app verify` command that **builds once, boots the
preview once, then runs Playwright and the ZAP scan against that single server**, and tears it
down. Playwright reuses the already-booted server via `PLAYWRIGHT_REUSE_SERVER=1` (kit#673), so it
never rebuilds.

`verify` receives the pushed file list and keeps the scan narrowly triggered: E2E always runs, but
the ~34s ZAP scan runs **only** when a header/cookie-affecting file changed — `_headers`,
`src/hooks.server.ts`, `+server.ts` / `+*.server.ts`, `wrangler.jsonc`, `svelte.config.js`, or
`zap-baseline.conf`. A baseline scan is passive (it only observes response headers and cookie
attributes), so a component or utility change cannot alter its result, and spending ~34s per push
on one is how hooks end up bypassed. An empty file list is fail-safe → scan (a security check is
never skipped silently).

**The port must be free.** Before booting, `verify` checks whether anything already answers on 4173
and stops if so, naming the port and the command that identifies the owner. It never adopts a server
it did not start: a stranger's preview (or an orphaned `wrangler dev` from an interrupted run) would
otherwise satisfy every readiness probe, and both Playwright and the scan would check that
application instead of yours — the header findings would then say nothing about this build. A boot
that dies before answering also fails immediately with the server's own output, rather than being
polled until the two-minute deadline.

`package.json` and `pnpm-lock.yaml` are excluded on purpose: a version bump rewrites
`package.json` on essentially every commit, so including it would fire the scan every time and
undo the narrowing. Dependency-driven header changes are caught by the **nightly** scheduled scan
(above), which rebuilds and scans the full app.

**Docker is required.** The scan runs in a container, and a missing daemon fails the command
loudly rather than skipping it — a security check that silently no-ops is worse than one that is
absent, because the green result gets misread as coverage.

**Triage findings in `zap-baseline.conf`.** Every ZAP rule defaults to `WARN`, and the scan exits
non-zero when anything is reported, so an untriaged finding fails the build. Silence one only
with a recorded reason:

```text
10055	IGNORE	(Only the "style-src unsafe-inline" sub-alert fires; required by SvelteKit for transitions — see Content-Security-Policy below.)
```

### Security headers

`josh-app sync` seeds a root `_headers` file with a baseline (`X-Content-Type-Options`,
`X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`), which closes ZAP findings
10020 / 10021 / 10063.

**`_headers` covers static assets only.** Cloudflare applies it to asset responses; anything the
Worker renders — every SSR page — bypasses it. Apply the same baseline in your server hook:

```ts
// src/hooks.server.ts
import { security_headers } from '@joshuafolkken/app-kit/security'
import type { Handle } from '@sveltejs/kit'

export const handle: Handle = async ({ event, resolve }) =>
	security_headers.apply_security_headers(await resolve(event))
```

**Extending and overriding the baseline.** A real app usually wants _more_ than the baseline on its
SSR responses (`Strict-Transport-Security`, a site-specific `Content-Security-Policy`) and sometimes
a relaxed baseline value (`X-Frame-Options: SAMEORIGIN` when it embeds itself). Pass those as a
second argument instead of re-implementing the baseline and drifting from it — each entry is applied
_after_ the baseline, so a new name **extends** and a repeated name **overrides**:

```ts
const HSTS = 'max-age=31536000; includeSubDomains'

export const handle: Handle = async ({ event, resolve }) =>
	security_headers.apply_security_headers(await resolve(event), [
		['Strict-Transport-Security', HSTS], // extend: baseline omits it
		['X-Frame-Options', 'SAMEORIGIN'], // override: relax the baseline DENY (pair with CSP frame-ancestors 'self')
	])
```

`Strict-Transport-Security` is deliberately **not** in the baseline: its `max-age`/`preload` is a
site-specific HTTPS commitment (a browser that sees it refuses HTTP for the whole `max-age`), so
each app opts in with its own value via the second argument rather than inheriting one through sync.

Content-Security-Policy is deliberately **not** in `_headers` or the baseline: it is document-scoped
(meaningless on static assets) and a working SvelteKit CSP needs nonce/hash wiring, not a static
header line. It is configured through `kit.csp` in `svelte.config.js` instead (see below); a
consumer that still wants a header-based CSP on SSR passes it through the same second argument.

### Content-Security-Policy

`svelte.config.js` sets `kit.csp` so SvelteKit emits a real `Content-Security-Policy` header on
SSR pages (and a `<meta>` tag on prerendered ones), closing the ZAP finding **CSP Header Not Set
[10038]**. `mode: 'auto'` augments `script-src` with a per-request **nonce** on dynamic pages and
a **hash** on prerendered ones, so the app's own hydration script runs while inline injection is
blocked — the E2E in `demo/playwright/page.svelte.e2e.ts` proves hydration still works under it.

The directives are chosen so the **script surface stays locked** (`script-src 'self'` + nonce, no
`unsafe-inline`) — that is the real XSS defense. Two deliberate relaxations:

- `style-src` keeps `'unsafe-inline'`. SvelteKit's `app.html` ships an inline `style="display:
contents"` body wrapper and Svelte transitions inject inline `<style>` at runtime; a stricter
  `style-src` white-screens any consumer that uses a transition (the SvelteKit docs call this
  out). Inline _style_ cannot execute JS, so this relaxes the style surface only. ZAP notes it as
  the sole `10055` sub-alert; it is triaged in `zap-baseline.conf`, and a unit test in
  `config-presets.test.ts` guards that `script-src` never gains `unsafe-inline` behind that IGNORE.
- `frame-ancestors 'none'` and `form-action 'self'` are listed explicitly because they do **not**
  fall back to `default-src` — omitting them re-opens `10055`'s "no fallback" sub-alert.

**`svelte.config.js` is yours** — `josh-app sync` does not distribute it. Copy the `kit.csp` block
from this repo's `svelte.config.js` as a starting point and adjust the directives for your app
(e.g. add `connect-src` / `img-src` origins for third-party APIs or CDNs you call).

`josh-app sync` seeds both `zap-baseline.conf` and `_headers` once and never rewrites them: the
triage decisions and header policy are yours.
`.github/workflows/dast.yml`, by contrast, is fully managed and overwritten on every sync — it is
a **separate, additive** workflow that never touches `.github/workflows/ci.yml`, which kit
single-sources. Two packages mastering one path would make the result depend on sync order.

## Load testing (k6)

`josh-app load` measures how the app behaves under load. It builds the project, boots the preview
server, runs a [k6](https://grafana.com/docs/k6/) scenario against it, and tears the server down —
reusing the same build/boot/teardown path as `dast` and `verify` (one preview, not a second
implementation). It reports latency and throughput; it is **not** a pass/fail gate.

**Prerequisite: k6 on `PATH`.** Unlike the ZAP scan (Docker), the load test runs the k6 binary
directly — install it first (`brew install k6`, or see the
[k6 install docs](https://grafana.com/docs/k6/latest/set-up/install-k6/)). A missing k6 fails the
command with an actionable message rather than skipping silently.

```bash
pnpm josh-app load          # build → boot preview → run the baseline k6/load-test.js → tear down
pnpm josh-app load:stress   # same lifecycle, but run the "attacking" k6/stress-test.js instead
```

**Two scenarios ship; both are yours.** `josh-app sync` seeds a gentle **`k6/load-test.js`**
(baseline: a few VUs with think-time, for a stable p95 and regression tracking) and an
**`k6/stress-test.js`** (a ramping arrival-rate probe with no think-time, to find the throughput
ceiling — where p95 spikes or errors appear is your limit). Each is seeded once and never rewritten
— VUs, duration, rates, and the exercised endpoints are project-specific, so tune them for your app.

The one line `josh-app sync` does keep is the `// @ts-nocheck` header. The scenarios target k6's own
JS runtime, so a project whose `tsconfig.json` type-checks `**/*.js` cannot compile them (the `k6` /
`k6/http` imports and `__ENV` do not resolve) — the directive keeps `tsc --noEmit` off them, exactly
as the app-kit ESLint preset already ignores `k6/**`. Sync adds it to a scenario seeded by an
earlier version and otherwise leaves your tuning untouched. Delete it only if you add `@types/k6`.

**Pick a scenario per run.** `josh-app load` runs the baseline and `josh-app load:stress` runs the
stress scenario; to run **your own**, pass its path: `josh-app load path/to/scenario.js`. Every
scenario reads its target from `__ENV.BASE_URL`, which the command points at the preview on `:4173`
— so the same file can also run standalone against a deployed URL:
`k6 run -e BASE_URL=https://your-app.workers.dev k6/load-test.js`.

**Report-only by default.** The seeded scenario defines **no thresholds**, so a run always exits 0
and surfaces numbers without failing on an uncalibrated baseline. Add a `thresholds` block (e.g.
`http_req_duration: ['p(95)<500']`) once a few runs have given you a real baseline — k6 then exits
non-zero when a threshold is breached.

**Runs manually, not per-PR and not on a schedule.** Unlike `dast.yml` (a deterministic pass/fail
that runs nightly), a load test reports numbers that need a baseline to interpret, and noisy CI
runners make an uncalibrated scheduled run decay into noise. So the distributed `load.yml` triggers
on **`workflow_dispatch`** only (the Actions "Run workflow" button), with the `schedule:` block
shipped **commented out** — uncomment it once your app has a real workload and a calibrated
baseline. It is also deliberately **not** a `lefthook` hook: a minutes-long push step invites
`--no-verify`. Like `dast.yml`, `load.yml` is a **separate, additive** workflow that never touches
`ci.yml`.

## Library usage

Add app-kit as a devDependency, then import the pieces you need. Every entry point is a separate subpath export, so unused features are tree-shaken away.

| Import                                      | Provides                                                         |
| ------------------------------------------- | ---------------------------------------------------------------- |
| `@joshuafolkken/app-kit`                    | Package entry — runtime feature namespaces                       |
| `@joshuafolkken/app-kit/theme`              | `theme_store` and the `Theme` type                               |
| `@joshuafolkken/app-kit/i18n`               | `locale_store` and the `Locale` type                             |
| `@joshuafolkken/app-kit/security`           | `security_headers` — baseline security headers for SSR responses |
| `@joshuafolkken/app-kit/eslint/sveltekit`   | SvelteKit ESLint flat-config preset                              |
| `@joshuafolkken/app-kit/tsconfig/sveltekit` | SvelteKit `tsconfig` preset (extend from your `tsconfig.json`)   |
| `@joshuafolkken/app-kit/cspell/sveltekit`   | SvelteKit cspell word/config preset                              |

Example — extend the ESLint preset:

```js
// eslint.config.js
import { create_sveltekit_config } from '@joshuafolkken/app-kit/eslint/sveltekit'

export default [
	...create_sveltekit_config({
		gitignore_path: new URL('./.gitignore', import.meta.url),
		tsconfig_root_dir: import.meta.dirname,
	}),
]
```

## Contributing

Community standards live in [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md); security reports go through [SECURITY.md](./SECURITY.md). Development conventions are documented in `CLAUDE.md`, `AGENTS.md`, and `GEMINI.md`.
