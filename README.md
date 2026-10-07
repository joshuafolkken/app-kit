# @joshuafolkken/app-kit

[![Claude Code](https://img.shields.io/badge/Claude_Code-supported-D97757?logo=claude&logoColor=white)](https://claude.com/claude-code)
[![Codex](https://img.shields.io/badge/Codex-supported-412991)](https://openai.com/codex/)
[![npm version](https://img.shields.io/npm/v/@joshuafolkken/app-kit)](https://www.npmjs.com/package/@joshuafolkken/app-kit)
[![License](https://img.shields.io/github/license/joshuafolkken/app-kit)](./LICENSE)

[![SvelteKit](https://img.shields.io/github/package-json/dependency-version/joshuafolkken/app-kit/dev/@sveltejs/kit?logo=svelte&label=SvelteKit)](https://svelte.dev/docs/kit)
[![Svelte](https://img.shields.io/npm/dependency-version/@joshuafolkken/app-kit/peer/svelte?logo=svelte&label=Svelte)](https://svelte.dev/)
[![Cloudflare Workers](https://img.shields.io/github/package-json/dependency-version/joshuafolkken/app-kit/dev/wrangler?logo=cloudflare&label=Cloudflare%20Workers)](https://workers.cloudflare.com/)

[![Node.js](https://img.shields.io/node/v/@joshuafolkken/app-kit?logo=nodedotjs)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/github/package-json/dependency-version/joshuafolkken/app-kit/dev/typescript?logo=typescript&label=TypeScript)](https://www.typescriptlang.org/)
[![pnpm](https://img.shields.io/badge/dynamic/regex?url=https%3A%2F%2Fraw.githubusercontent.com%2Fjoshuafolkken%2Fapp-kit%2Fmain%2Fpackage.json&search=pnpm%40%28%5B0-9.%5D%2B%29&replace=%241&logo=pnpm&label=pnpm)](https://pnpm.io/)

[![CI](https://github.com/joshuafolkken/app-kit/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/joshuafolkken/app-kit/actions/workflows/ci.yml)
[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=joshuafolkken_app-kit&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=joshuafolkken_app-kit)

**kit for SvelteKit on Cloudflare — one command sets up the whole project.**

app-kit adds SvelteKit and Cloudflare checks on top of [kit](https://github.com/joshuafolkken/kit)'s rules, checks and Issue-driven workflow.

## Sound familiar?

Each pain links to how it is solved — or read [the whole story](./docs/why.md).

| Your pain                                                                                                      | [kit] | app-kit | [game-kit] |
| -------------------------------------------------------------------------------------------------------------- | :---: | :-----: | :--------: |
| [I keep repeating the same instructions](./docs/why.md#i-keep-repeating-the-same-instructions)                 |  ✅   |   ✅    |     ✅     |
| [Wiring AI up to GitHub is a chore](./docs/why.md#wiring-ai-up-to-github-is-a-chore)                           |  ✅   |   ✅    |     ✅     |
| [Setting up SvelteKit on Cloudflare takes a day](./docs/why.md#setting-up-sveltekit-on-cloudflare-takes-a-day) |   —   |   ✅    |     ✅     |
| [I'm not sure the app is secure](./docs/why.md#im-not-sure-the-app-is-secure)                                  |   —   |   ✅    |     ✅     |
| [Nobody looked at the screen](./docs/why.md#nobody-looked-at-the-screen)                                       |   —   |   ✅    |     ✅     |
| [E2E rebuilds the app again and again](./docs/why.md#e2e-rebuilds-the-app-again-and-again)                     |   —   |   ✅    |     ✅     |
| [I don't know if it holds up under load](./docs/why.md#i-dont-know-if-it-holds-up-under-load)                  |   —   |   ✅    |     ✅     |
| [Starting a 3D game means building it all first](https://github.com/joshuafolkken/game-kit)                    |   —   |    —    |     ✅     |

Each kit includes the one to its left: app-kit builds on kit, game-kit builds on app-kit.

[kit]: https://github.com/joshuafolkken/kit
[game-kit]: https://github.com/joshuafolkken/game-kit

## What your project gets

| Area         | What you get                                |
| ------------ | ------------------------------------------- |
| Setup        | kit plus the SvelteKit + Cloudflare layer   |
| Presets      | ESLint, TypeScript and spelling config      |
| Runtime      | Theme, i18n and security helpers            |
| Security     | Security headers and a vulnerability scan   |
| Verification | One pre-push check, screenshots, load tests |

[What each one includes](./docs/overview.md#what-it-provides)

## Quick start

Requires Node.js, pnpm and the gh CLI — [how to install them](./docs/setup/prerequisites.md).

From the root of a SvelteKit project:

```bash
pnpm add -D --allow-build=esbuild --allow-build=unrs-resolver @joshuafolkken/app-kit && pnpm exec josh-app start
```

That installs kit's base and the SvelteKit + Cloudflare overlay, makes the first commit, and creates the GitHub repository (or opens a setup pull request when `main` already exists). Then open your agent and follow kit's [tutorial](https://github.com/joshuafolkken/kit/blob/main/docs/tutorial.md).

Already using app-kit? [Update it](./docs/how-to/update-app-kit.md)

## Docs

[Install](./docs/setup/install.md) · [How-to](./docs/how-to.md) · [Commands](./docs/cli.md) · [All docs](./docs/overview.md)

[Contributing](./CLAUDE.md) · [Publishing](./docs/maintainers/publishing.md) · [MIT](./LICENSE)
