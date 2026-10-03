# @joshuafolkken/app-kit

**kit for SvelteKit on Cloudflare — one command sets up the whole project.**

app-kit adds SvelteKit and Cloudflare checks on top of [kit](https://github.com/joshuafolkken/kit)'s rules, checks and Issue-driven workflow.

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
pnpm add -g @joshuafolkken/app-kit
pnpm add -D @joshuafolkken/app-kit
josh-app init
```

Then commit the setup, open your agent and follow kit's [tutorial](https://github.com/joshuafolkken/kit/blob/main/docs/tutorial.md).

Already using app-kit? [Update it](./docs/how-to/update-app-kit.md)

## Docs

[Install](./docs/setup/install.md) · [How-to](./docs/how-to.md) · [Commands](./docs/cli.md) · [All docs](./docs/overview.md)

[Contributing](./CLAUDE.md) · [Publishing](./docs/maintainers/publishing.md) · [MIT](./LICENSE)
