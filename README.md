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
| `josh-app version` / `v`          | Report installed-vs-latest version                                        |
| `josh-app version:upgrade` / `vu` | Upgrade to the latest version                                             |

## Library usage

Add app-kit as a devDependency, then import the pieces you need. Every entry point is a separate subpath export, so unused features are tree-shaken away.

| Import                                      | Provides                                                       |
| ------------------------------------------- | -------------------------------------------------------------- |
| `@joshuafolkken/app-kit`                    | Package entry — runtime feature namespaces                     |
| `@joshuafolkken/app-kit/theme`              | `theme_store` and the `Theme` type                             |
| `@joshuafolkken/app-kit/i18n`               | `locale_store` and the `Locale` type                           |
| `@joshuafolkken/app-kit/eslint/sveltekit`   | SvelteKit ESLint flat-config preset                            |
| `@joshuafolkken/app-kit/tsconfig/sveltekit` | SvelteKit `tsconfig` preset (extend from your `tsconfig.json`) |
| `@joshuafolkken/app-kit/cspell/sveltekit`   | SvelteKit cspell word/config preset                            |

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
