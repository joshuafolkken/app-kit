# Security scanning (DAST)

The static layers inherited from kit (CodeQL, SonarCloud, OSV-Scanner, secretlint) never start the app. `josh-app dast` closes that gap: it builds the project, boots the preview server, runs the [OWASP ZAP](https://www.zaproxy.org/) baseline scan against it, and tears the server down — including on failure. The scan is passive (no attack traffic), so it is safe against a local preview. It catches the class static analysis structurally cannot see: missing security headers, unset or weak CSP, and `Secure` / `HttpOnly` / `SameSite` gaps on cookies.

**Docker is required.** The scan runs in a container, and a missing daemon fails the command loudly rather than skipping it — a security check that silently no-ops is worse than one that is absent, because the green result gets misread as coverage.

## Where it runs

All three share one implementation:

| Where          | How                                                                             |
| -------------- | ------------------------------------------------------------------------------- |
| Manually       | `pnpm josh-app dast` (local) or the Actions **Run workflow** button (CI)        |
| Before a push  | Inside `josh-app verify` — the unified pre-push gate ([verify.md](./verify.md)) |
| CI (scheduled) | `.github/workflows/dast.yml` runs the full scan **nightly**, not per-PR         |

**Why nightly, not per-PR.** The ZAP baseline needs the full ~2.2 GB `zaproxy` image, which ephemeral CI runners re-pull on every run. Paying that on every PR is wasteful — and since `dast.yml` is a distributed default, it would land on every consumer's CI. The per-PR value (the security-header findings the scan reports) is already covered by the Docker-free E2E assertions in `src/routes/security-headers.e2e.ts`, which `josh-app sync` seeds into your project ([security-headers.md → The per-PR E2E spec](./security-headers.md#the-per-pr-e2e-spec)), so the full scan only needs to run **nightly** as the broad safety net. Trigger it on demand anytime via the Actions "Run workflow" button (`workflow_dispatch`) or locally with `pnpm josh-app dast`. A failed scheduled run is surfaced by GitHub (email + a red run in the Actions tab) and never blocks a PR.

## Triage findings in `zap-baseline.conf`

Every ZAP rule defaults to `WARN`, and the scan exits non-zero when anything is reported, so an untriaged finding fails the build. Silence one only with a recorded reason:

```text
10055	IGNORE	(Only the "style-src unsafe-inline" sub-alert fires; required by SvelteKit for transitions — see Content-Security-Policy below.)
```

The `style-src` reasoning behind that line: [security-headers.md → Content-Security-Policy](./security-headers.md#content-security-policy).

## Seeded files and managed workflows

`josh-app sync` seeds `_headers` once and never rewrites it: the header policy is yours. `zap-baseline.conf` is seeded once too, and later syncs only append the universal baseline rules it is missing, under a merge marker. A rule already present — active or commented out — is never touched, so your triage decisions survive; to opt out of a baseline rule, comment it out rather than deleting it, or the next sync adds it back. `.github/workflows/dast.yml`, by contrast, is fully managed and overwritten on every sync — it is a **separate, additive** workflow that never touches `.github/workflows/ci.yml`, which kit single-sources. Two packages mastering one path would make the result depend on sync order.

**Managed workflows carry a stamp** (app-kit 0.82.0). `dast.yml` and `load.yml` are written with a two-line header naming app-kit:

```yaml
# josh-managed-workflow: @joshuafolkken/app-kit
# Overwritten on every sync of that package. Edit it there, not here.
```

The header is what kit's distributed `dependabot-auto-merge.yml` reads to decide that a Dependabot bump to one of these files must **not** auto-merge. Without it the bump merges, your next `josh-app sync` writes app-kit's pins straight back, and Dependabot proposes the same bump again. Leave the two lines in place; edits to these workflows belong in app-kit either way.

The decision is per **pull request**, not per file. Dependabot's github-actions updates open one PR per action and edit every workflow that uses it, so a PR that touches `dast.yml` alongside a workflow you own is held open as a whole — the bump to your own workflow rides along and waits for you. Only a PR that touches no stamped workflow at all auto-merges. Merging such a PR by hand is fine: the pins in your own workflows are yours, and app-kit rewrites only the files it stamps.
