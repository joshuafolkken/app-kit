# Set up app-kit

The detailed version of the [Quick start](../README.md#quick-start). app-kit runs kit's base setup first and then applies the SvelteKit + Cloudflare overlay, so one command gives a project both.

## 1. Check the prerequisites

- [Node.js](https://nodejs.org/) with [pnpm](https://pnpm.io/).
- **A POSIX shell.** The `package.json` scripts app-kit distributes are written for `sh`: `dev` and `preview` resolve their port with `$(josh port …)`, and the `prepare` chain gates on `[ … ]` and `command -v`. `cmd.exe` has none of that, so on Windows run them from WSL or Git Bash — a plain `cmd.exe` fails at `pnpm install`, before any server script. pnpm's `shell-emulator` is not a substitute: its shell cannot parse `!`, which breaks the `prepare` guards.
- The [gh CLI](https://cli.github.com/), signed in — it supplies the GitHub Packages token below. Install it with `brew install gh` (macOS), `winget install GitHub.cli` (Windows), or see the [gh installation docs](https://github.com/cli/cli#installation).

## 2. Authenticate to GitHub Packages

app-kit is published to the GitHub Packages registry, which requires a token even for public packages. Set it up once per machine:

1. Get a token from the `gh` CLI and persist `NODE_AUTH_TOKEN`: kit's [authentication.md §1](https://github.com/joshuafolkken/kit/blob/main/docs/authentication.md#1-get-a-token-from-the-gh-cli).
2. Route the `@joshuafolkken` scope to GitHub Packages in your user-level `~/.npmrc`:

   ```ini
   @joshuafolkken:registry=https://npm.pkg.github.com
   //npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
   ```

   `${NODE_AUTH_TOKEN}` stays a literal placeholder: pnpm expands it at install time, so no secret is written to disk. The token needs the `read:packages` scope. Without it, install fails with `ERR_PNPM_FETCH_401`.

On a fresh checkout of a project that already uses app-kit, `pnpm config get "@joshuafolkken:registry"` shows the effective registry, including your user-level mapping.

A deploy builder has no `~/.npmrc`, so it needs its own setup: [deploy-authentication.md](./deploy-authentication.md).

## 3. Install

```bash
pnpm add -g @joshuafolkken/app-kit   # the josh-app CLI, run from any project directory
pnpm add -D @joshuafolkken/app-kit   # the presets the generated config imports
```

The two installs are separate on purpose. `josh-app init` wires app-kit's presets into the scaffolded `eslint.config.js`, `tsconfig.json`, cspell and lefthook config, and those imports resolve only from the project's own `devDependencies`.

> **Version-age gotcha.** A supply-chain safety delay (`minimum-release-age`, 24h) can resolve a bare `pnpm add -g @joshuafolkken/app-kit` to an **older** published version. While the version you want is still inside its 24h window, pin it and skip the age gate:
>
> ```bash
> pnpm add -g @joshuafolkken/app-kit@<version> --safe-chain-skip-minimum-package-age
> ```
>
> Once the target version ages past 24h, a bare `pnpm add -g @joshuafolkken/app-kit` resolves to the latest.

## 4. Initialize

From the root of a SvelteKit project:

```bash
josh-app init
pnpm josh gate
```

`josh-app init` runs kit's framework-agnostic `josh init` first, then applies the SvelteKit + Cloudflare overlay on top: the managed `package.json` scripts, the SvelteKit config lines, the Cloudflare `wrangler.jsonc` worker name and the seeded files (`_headers`, `zap-baseline.conf`, the security-headers E2E spec and the k6 scenarios). What kit's base creates is described in kit's [init.md](https://github.com/joshuafolkken/kit/blob/main/docs/init.md).

## 5. Keep it up to date

```bash
josh-app version             # installed vs. latest, including the kit the CLI runs
josh-app version --upgrade   # upgrade the global and project installs
josh-app sync                # re-apply kit's base and the overlay
```

`josh-app sync` is idempotent. It overwrites the files app-kit manages (the managed scripts, `dast.yml`, `load.yml`) and never overwrites the seeded files you own (`zap-baseline.conf` only gains missing baseline rules — [dast.md](./dast.md#seeded-files-and-managed-workflows)). How an upgrade reaches the kit bundled with the global CLI: [cli.md → The effective kit](./cli.md#the-effective-kit).

## Next

- Every command: [cli.md](./cli.md).
- Import the runtime features and presets: [package-api.md](./package-api.md).
- Apply the security-header baseline in your server hook: [security-headers.md](./security-headers.md).
