# @joshuafolkken/app-kit

The SvelteKit + Cloudflare layer on top of [`@joshuafolkken/kit`](https://github.com/joshuafolkken/kit). `josh-app init` sets up kit's base (AI assistant files, formatting, lint, tests, Git hooks) and then the SvelteKit + Cloudflare overlay in one command; `josh-app sync` keeps both up to date. The package also ships tree-shakeable runtime features (theme, i18n, security headers) and SvelteKit config presets.

## What your project gets

| Area            | What you get                                                                               |
| --------------- | ------------------------------------------------------------------------------------------ |
| Setup           | kit's base plus the SvelteKit + Cloudflare overlay, from `josh-app init` / `josh-app sync` |
| Config presets  | ESLint, `tsconfig` and cspell presets for SvelteKit                                        |
| Runtime         | `theme`, `i18n` and `security` modules, each its own subpath export                        |
| Security checks | Security headers, a per-PR headers E2E spec and an OWASP ZAP baseline scan (DAST)          |
| Verification    | One pre-push gate (build once, E2E + DAST), route screenshots and k6 load tests            |

## Quick start

Requires [Node.js](https://nodejs.org/), [pnpm](https://pnpm.io/), a POSIX shell (WSL or Git Bash on Windows) and the [gh CLI](https://cli.github.com/). app-kit is published to public npm, so installing it needs no token; projects that already install from GitHub Packages keep working ([setup.md → Choose the registry](https://github.com/joshuafolkken/app-kit/blob/main/docs/setup.md#2-choose-the-registry)). From the root of a SvelteKit project:

```bash
pnpm add -g @joshuafolkken/app-kit   # the josh-app CLI
pnpm add -D @joshuafolkken/app-kit   # the presets the generated config imports
josh-app init
pnpm josh gate
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

## Contributing

Conventions are in [CLAUDE.md](https://github.com/joshuafolkken/app-kit/blob/main/CLAUDE.md). See [CODE_OF_CONDUCT.md](https://github.com/joshuafolkken/app-kit/blob/main/CODE_OF_CONDUCT.md) and [SECURITY.md](https://github.com/joshuafolkken/app-kit/blob/main/SECURITY.md); maintainer records are in [docs/maintainers/](https://github.com/joshuafolkken/app-kit/tree/main/docs/maintainers).
