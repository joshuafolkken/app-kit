# Install app-kit

The detailed version of the [Quick start](../../README.md#quick-start). app-kit runs kit's base setup first and then applies the SvelteKit + Cloudflare overlay, so one command gives a project both. Check the [prerequisites](./prerequisites.md) first.

## 1. Choose the registry

Every release of app-kit is published to both [public npm](https://www.npmjs.com/package/@joshuafolkken/app-kit) and GitHub Packages, with the same version on each.

**New users: nothing to set up.** With no `@joshuafolkken:registry` mapping anywhere, pnpm installs app-kit and kit from public npm without a token. Check it with `pnpm config get "@joshuafolkken:registry"`: `undefined` means public npm.

**Existing users: GitHub Packages keeps working.** A machine or project that already routes the `@joshuafolkken` scope to GitHub Packages continues to install from there, and needs the token described below. Moving existing projects to public npm is a later step.

### Authenticate to GitHub Packages

GitHub Packages requires a token even for public packages. Set it up once per machine:

1. Get a token from the `gh` CLI and persist `NODE_AUTH_TOKEN`: kit's [authentication.md §1](https://github.com/joshuafolkken/kit/blob/main/docs/authentication.md#1-get-a-token-from-the-gh-cli).
2. Route the `@joshuafolkken` scope to GitHub Packages in your user-level `~/.npmrc`:

   ```ini
   @joshuafolkken:registry=https://npm.pkg.github.com
   //npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
   ```

   `${NODE_AUTH_TOKEN}` stays a literal placeholder: pnpm expands it at install time, so no secret is written to disk. The token needs the `read:packages` scope. Without it, install fails with `ERR_PNPM_FETCH_401`.

On a fresh checkout of a project that already uses app-kit, `pnpm config get "@joshuafolkken:registry"` shows the effective registry, including your user-level mapping.

A deploy builder that installs from GitHub Packages has no `~/.npmrc`, so it needs its own setup: [deploy-authentication.md](../deploy-authentication.md). A project that installs from public npm needs none.

## 2. Install

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

## 3. Initialize

From the root of a SvelteKit project:

```bash
josh-app init
pnpm josh gate
```

`josh-app init` runs kit's framework-agnostic `josh init` first, then applies the SvelteKit + Cloudflare overlay on top: the managed `package.json` scripts, the SvelteKit config lines, the Cloudflare `wrangler.jsonc` worker name and the seeded files (`_headers`, `zap-baseline.conf`, the security-headers E2E spec and the k6 scenarios). What kit's base creates is described in kit's [init.md](https://github.com/joshuafolkken/kit/blob/main/docs/init.md).

## Next

- Keep it current: [Update app-kit](../how-to/update-app-kit.md).
- Every command: [cli.md](../cli.md).
- Import the runtime features and presets: [package-api.md](../package-api.md).
- Apply the security-header baseline in your server hook: [security-headers.md](../security-headers.md).
