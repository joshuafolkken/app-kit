# @joshuafolkken/app-kit

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
pnpm add -D @joshuafolkken/app-kit && pnpm exec josh-app start
```

That installs kit's base and the SvelteKit + Cloudflare overlay, makes the first commit, and creates the GitHub repository (or opens a setup pull request when `main` already exists). Then open your agent and follow kit's [tutorial](https://github.com/joshuafolkken/kit/blob/main/docs/tutorial.md).

Already using app-kit? [Update it](./docs/how-to/update-app-kit.md)

## Docs

[Install](./docs/setup/install.md) · [How-to](./docs/how-to.md) · [Commands](./docs/cli.md) · [All docs](./docs/overview.md)

[Contributing](./CLAUDE.md) · [Publishing](./docs/maintainers/publishing.md) · [MIT](./LICENSE)
