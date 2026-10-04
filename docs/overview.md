# @joshuafolkken/app-kit — Overview

For anyone deciding whether app-kit fits their project: what it sets up and how it works. `@joshuafolkken/app-kit` is the SvelteKit + Cloudflare layer on top of [`@joshuafolkken/kit`](https://github.com/joshuafolkken/kit). kit gives any project the AI assistant rules, formatting, lint, tests, Git hooks and the Issue workflow ([kit's overview](https://github.com/joshuafolkken/kit/blob/main/docs/overview.md)); app-kit adds what a SvelteKit app on Cloudflare needs.

## What it provides

| Area            | What you get                                                                      | Details                                                                                |
| --------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Setup           | kit's base plus the SvelteKit + Cloudflare overlay, from one command              | [setup/install.md](./setup/install.md)                                                 |
| Config presets  | ESLint, `tsconfig` and cspell presets for SvelteKit                               | [package-api.md](./package-api.md)                                                     |
| Runtime         | `theme`, `i18n` and `security` modules, each its own subpath export               | [package-api.md](./package-api.md)                                                     |
| Security checks | Security headers, a per-PR headers E2E spec and an OWASP ZAP baseline scan (DAST) | [security-headers.md](./security-headers.md) · [dast.md](./dast.md)                    |
| Verification    | One pre-push gate (build once, E2E + DAST), route screenshots and k6 load tests   | [verify.md](./verify.md) · [shot.md](./shot.md) · [load-testing.md](./load-testing.md) |

## How it works

1. **Install** — the global `josh-app` CLI and the project devDependency ([Install app-kit](./setup/install.md)).
2. **Init** — `josh-app init` runs kit's `josh init`, then applies the overlay: managed `package.json` scripts, SvelteKit config lines, the Cloudflare worker name and the seeded files.
3. **Sync** — `josh-app sync` after upgrading re-applies both layers; it overwrites what app-kit manages and never the files you own ([Update app-kit](./how-to/update-app-kit.md)).
4. **josh-app CLI** — one binary for init, sync, version checks, the pre-push gate and screenshots ([cli.md](./cli.md)).

To find the steps for a task, start at [how-to.md](./how-to.md). The full list of guides is below.

## Documentation

**Set up**

- [setup/prerequisites.md](./setup/prerequisites.md) — Node.js, pnpm, a POSIX shell and the gh CLI
- [setup/install.md](./setup/install.md) — registry choice, install and initialize
- [deploy-authentication.md](./deploy-authentication.md) — installing from GitHub Packages on Cloudflare Workers Builds (public npm needs no setup)

**Use**

- [how-to.md](./how-to.md) — guides by task
- [how-to/update-app-kit.md](./how-to/update-app-kit.md) — upgrade and re-sync

**Commands and packages**

- [cli.md](./cli.md) — every `josh-app` command, and how upgrades reach the bundled kit
- [package-api.md](./package-api.md) — runtime features and config presets

**Security**

- [security-headers.md](./security-headers.md) — the header baseline, Content-Security-Policy and the per-PR E2E spec
- [dast.md](./dast.md) — the OWASP ZAP baseline scan and the workflows app-kit manages

**Verification and testing**

- [verify.md](./verify.md) — the unified pre-push gate and the preview port
- [shot.md](./shot.md) — UI verification screenshots
- [load-testing.md](./load-testing.md) — k6 load and stress tests

**The kit base**

- [kit's overview.md](https://github.com/joshuafolkken/kit/blob/main/docs/overview.md) — what kit sets up and how it works
- [kit's tutorial.md](https://github.com/joshuafolkken/kit/blob/main/docs/tutorial.md) — your first change with an agent, from Issue to merge
- [kit's josh-commands.md](https://github.com/joshuafolkken/kit/blob/main/docs/josh-commands.md) — every `josh` command, such as `pnpm josh gate`

**Maintaining app-kit**

- [maintainers/publishing.md](./maintainers/publishing.md) — releasing a new version
- [maintainers/](./maintainers/) — maintainer records
