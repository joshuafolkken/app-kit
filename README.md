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

| Command                           | What it does                                                              |
| --------------------------------- | ------------------------------------------------------------------------- |
| `josh-app init`                   | Apply kit's base then the SvelteKit + Cloudflare overlay to a project     |
| `josh-app sync`                   | Re-sync the overlay (scripts, seeds, SvelteKit config lines) idempotently |
| `josh-app check`                  | Fast incremental SvelteKit type-check (dev loop)                          |
| `josh-app check:ci`               | Strict SvelteKit type-check (CI variant)                                  |
| `josh-app dast`                   | Dynamic baseline security scan against the running preview server         |
| `josh-app version` / `v`          | Report installed-vs-latest version                                        |
| `josh-app version:upgrade` / `vu` | Upgrade to the latest version                                             |

## Security scanning (DAST)

The static layers inherited from kit (CodeQL, SonarCloud, OSV-Scanner, secretlint) never start
the app. `josh-app dast` closes that gap: it builds the project, boots the preview server, runs
the [OWASP ZAP](https://www.zaproxy.org/) baseline scan against it, and tears the server down —
including on failure. The scan is passive (no attack traffic), so it is safe against a local
preview. It catches the class static analysis structurally cannot see: missing security headers,
unset or weak CSP, and `Secure` / `HttpOnly` / `SameSite` gaps on cookies.

It runs in three places, all sharing one implementation:

| Where         | How                                                                          |
| ------------- | ---------------------------------------------------------------------------- |
| Manually      | `pnpm josh-app dast`                                                         |
| Before a push | The `dast` command in `lefthook/sveltekit.yml` (`pre-push`, narrowly scoped) |
| CI            | `.github/workflows/dast.yml`, distributed by `josh-app sync`                 |

The pre-push hook fires only on files that can change the verdict — `_headers`,
`src/hooks.server.ts`, `+server.ts`, `wrangler.jsonc`, `svelte.config.js`, and
`zap-baseline.conf`. A baseline scan is passive, so it only observes response headers and cookie
attributes; a component or utility change cannot alter the result, and spending ~45s per push on
one is how hooks end up bypassed.

`package.json` and `pnpm-lock.yaml` are excluded on purpose: a version bump rewrites
`package.json` on essentially every commit, so including it would fire the scan every time and
undo the narrowing. Dependency-driven header changes are caught by CI, which runs the scan
unconditionally on every PR.

**Docker is required.** The scan runs in a container, and a missing daemon fails the command
loudly rather than skipping it — a security check that silently no-ops is worse than one that is
absent, because the green result gets misread as coverage.

**Triage findings in `zap-baseline.conf`.** Every ZAP rule defaults to `WARN`, and the scan exits
non-zero when anything is reported, so an untriaged finding fails the build. Silence one only
with a recorded reason:

```text
10038	IGNORE	(CSP is set at the CDN edge, not by the worker — verified in production headers)
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

Content-Security-Policy is deliberately **not** included: a working SvelteKit CSP needs
nonce/hash wiring via `kit.csp` in `svelte.config.js`, not a static header line.

`josh-app sync` seeds both `zap-baseline.conf` and `_headers` once and never rewrites them: the
triage decisions and header policy are yours.
`.github/workflows/dast.yml`, by contrast, is fully managed and overwritten on every sync — it is
a **separate, additive** workflow that never touches `.github/workflows/ci.yml`, which kit
single-sources. Two packages mastering one path would make the result depend on sync order.

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
