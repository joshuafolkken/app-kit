# @joshuafolkken/app-kit

**kit for SvelteKit on Cloudflare — one command sets up the whole project.**

app-kit adds SvelteKit and Cloudflare checks on top of [kit](https://github.com/joshuafolkken/kit)'s rules, checks and Issue-driven workflow.

## Sound familiar?

[The whole story](./docs/why.md)

- [Setting up SvelteKit on Cloudflare takes a day](./docs/why.md#setting-up-sveltekit-on-cloudflare-takes-a-day)
- [I'm not sure the app is secure](./docs/why.md#im-not-sure-the-app-is-secure)
- [Nobody looked at the screen](./docs/why.md#nobody-looked-at-the-screen)

## Quick start

Requires [Node.js, pnpm and the gh CLI](./docs/setup/prerequisites.md).

From the root of a SvelteKit project:

```bash
gh auth login # once
pnpm add -D --allow-build=esbuild --allow-build=unrs-resolver @joshuafolkken/app-kit
pnpm exec josh-app start
```

Next: [tutorial](https://github.com/joshuafolkken/kit/blob/main/docs/tutorial.md)

Already using app-kit? [Update it](./docs/how-to/update-app-kit.md)

## Docs

[How-to](./docs/how-to.md) · [All docs](./docs/overview.md)

[kit](https://github.com/joshuafolkken/kit) · [game-kit](https://github.com/joshuafolkken/game-kit) · [Releases](https://github.com/joshuafolkken/app-kit/releases) · [Contributing](./CLAUDE.md)
