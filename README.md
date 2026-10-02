# @joshuafolkken/app-kit

The SvelteKit + Cloudflare layer on top of [`@joshuafolkken/kit`](https://github.com/joshuafolkken/kit). One command, `josh-app init`, gives a SvelteKit project everything kit sets up — the AI assistant rules, formatting, lint, tests, Git hooks and the Issue workflow — and then the SvelteKit + Cloudflare overlay: security headers, a DAST scan, a single pre-push gate and load tests. `josh-app sync` keeps both layers up to date, and the package also ships tree-shakeable runtime features and SvelteKit config presets.

## What your project gets

kit's base comes first and is described in kit's [overview.md](https://github.com/joshuafolkken/kit/blob/main/docs/overview.md); app-kit adds the rows below on top.

| Area            | What you get                                                                      | Details                                                                                                                                                                         |
| --------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Setup           | kit's base plus the SvelteKit + Cloudflare overlay, from one command              | [setup.md](https://github.com/joshuafolkken/app-kit/blob/main/docs/setup.md)                                                                                                    |
| Config presets  | ESLint, `tsconfig` and cspell presets for SvelteKit                               | [package-api.md](https://github.com/joshuafolkken/app-kit/blob/main/docs/package-api.md)                                                                                        |
| Runtime         | `theme`, `i18n` and `security` modules, each its own subpath export               | [package-api.md](https://github.com/joshuafolkken/app-kit/blob/main/docs/package-api.md)                                                                                        |
| Security checks | Security headers, a per-PR headers E2E spec and an OWASP ZAP baseline scan (DAST) | [security-headers.md](https://github.com/joshuafolkken/app-kit/blob/main/docs/security-headers.md) · [dast.md](https://github.com/joshuafolkken/app-kit/blob/main/docs/dast.md) |
| Verification    | One pre-push gate (build once, E2E + DAST), route screenshots and k6 load tests   | [verify.md](https://github.com/joshuafolkken/app-kit/blob/main/docs/verify.md) · [shot.md](https://github.com/joshuafolkken/app-kit/blob/main/docs/shot.md)                     |

## Quick start

Requires Node.js, pnpm, a POSIX shell and the gh CLI ([details](https://github.com/joshuafolkken/app-kit/blob/main/docs/setup.md#1-check-the-prerequisites)). Run from the root of a SvelteKit project.

### A new project

```bash
pnpm add -g @joshuafolkken/app-kit   # the josh-app CLI
pnpm add -D @joshuafolkken/app-kit   # the presets the generated config imports
josh-app init
pnpm josh gate
```

The two installs are separate on purpose: the generated config imports app-kit's presets from the project's own `devDependencies`.

### A project that already uses app-kit

```bash
josh-app version --upgrade   # upgrade the global and project installs
josh-app sync                # re-apply kit's base and the overlay
```

Step by step, with what each command creates: [setup.md](https://github.com/joshuafolkken/app-kit/blob/main/docs/setup.md).

## Documentation

**Set up**

- [setup.md](https://github.com/joshuafolkken/app-kit/blob/main/docs/setup.md) — prerequisites, registry choice, install, initialize and update
- [deploy-authentication.md](https://github.com/joshuafolkken/app-kit/blob/main/docs/deploy-authentication.md) — installing from GitHub Packages on Cloudflare Workers Builds (public npm needs no setup)

**Commands and packages**

- [cli.md](https://github.com/joshuafolkken/app-kit/blob/main/docs/cli.md) — every `josh-app` command, and how upgrades reach the bundled kit
- [package-api.md](https://github.com/joshuafolkken/app-kit/blob/main/docs/package-api.md) — runtime features and config presets

**Security**

- [security-headers.md](https://github.com/joshuafolkken/app-kit/blob/main/docs/security-headers.md) — the header baseline, Content-Security-Policy and the per-PR E2E spec
- [dast.md](https://github.com/joshuafolkken/app-kit/blob/main/docs/dast.md) — the OWASP ZAP baseline scan and the workflows app-kit manages

**Verification and testing**

- [verify.md](https://github.com/joshuafolkken/app-kit/blob/main/docs/verify.md) — the unified pre-push gate and the preview port
- [shot.md](https://github.com/joshuafolkken/app-kit/blob/main/docs/shot.md) — UI verification screenshots
- [load-testing.md](https://github.com/joshuafolkken/app-kit/blob/main/docs/load-testing.md) — k6 load and stress tests

**The kit base**

- [overview.md](https://github.com/joshuafolkken/kit/blob/main/docs/overview.md) — what kit sets up and how it works
- [tutorial.md](https://github.com/joshuafolkken/kit/blob/main/docs/tutorial.md) — your first change with an agent, from Issue to merge
- [josh-commands.md](https://github.com/joshuafolkken/kit/blob/main/docs/josh-commands.md) — every `josh` command, such as `pnpm josh gate`
- [scripts-ai.md](https://github.com/joshuafolkken/kit/blob/main/docs/scripts-ai.md) — Issue workflow commands and Telegram notifications

## Contributing

Conventions are in [CLAUDE.md](https://github.com/joshuafolkken/app-kit/blob/main/CLAUDE.md), releases in [publishing.md](https://github.com/joshuafolkken/app-kit/blob/main/docs/maintainers/publishing.md). See [CODE_OF_CONDUCT.md](https://github.com/joshuafolkken/app-kit/blob/main/CODE_OF_CONDUCT.md) and [SECURITY.md](https://github.com/joshuafolkken/app-kit/blob/main/SECURITY.md); maintainer records are in [docs/maintainers/](https://github.com/joshuafolkken/app-kit/tree/main/docs/maintainers).
