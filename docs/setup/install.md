# Install app-kit

The detailed version of the [Quick start](../../README.md#quick-start). app-kit runs kit's base setup first and then applies the SvelteKit + Cloudflare overlay, so one command gives a project both. Check the [prerequisites](./prerequisites.md) first.

## 1. Choose the registry

Every release of app-kit is published to both [public npm](https://www.npmjs.com/package/@joshuafolkken/app-kit) and GitHub Packages, with the same version on each.

**New users: nothing to set up.** With no `@joshuafolkken:registry` mapping anywhere, pnpm installs app-kit and kit from public npm without a token. Check it with `pnpm config get "@joshuafolkken:registry"`: `undefined` means public npm.

**Existing users: GitHub Packages keeps working.** A machine or project that already routes the `@joshuafolkken` scope to GitHub Packages continues to install from there, and needs the token described below. To move such a project to public npm, see [Move an existing project to public npm](#move-an-existing-project-to-public-npm).

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

A deploy builder that installs from GitHub Packages has no `~/.npmrc`, so it needs its own setup: [deploy-authentication.md](../deploy-authentication.md). A project that installs from public npm needs none: `josh-app init` writes no GitHub Packages credential into its `.npmrc`, and Cloudflare Workers Builds needs no `NODE_AUTH_TOKEN` or `PNPM_CONFIG_NPMRC_AUTH_FILE`.

### Move an existing project to public npm

kit's `josh registry:migrate` does the move. app-kit adds no command of its own; `josh-app sync` only tidies up after it.

1. **Migrate.** From the project root, on a clean working tree:

   ```bash
   pnpm josh registry:migrate
   ```

   It looks up every `@joshuafolkken/*` version in `pnpm-lock.yaml` on public npm, app-kit and kit included. If any of them is not published there, it changes nothing and exits with `Migration blocked: unpublished on npm: …`, naming each one. Upgrade those packages to a version that is on public npm and run it again. Otherwise it points the project `.npmrc` at `@joshuafolkken:registry=https://registry.npmjs.org/`, rewrites the lockfile's tarball and integrity entries to public npm, and confirms the result with a lockfile-only install. If that check fails, it restores the files. It reads `~/.npmrc` but never writes it, keeps every other `.npmrc` line, and a second run reports `Already using public npm; no changes made.`

2. **Sync.** Run `pnpm exec josh-app sync`. It removes the `//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}` line an earlier sync added. A token you wrote yourself, and a line you commented out, stay as they are. A later sync does not add the line back while the project routes the scope to public npm. The credential is keyed by host, not scope, so while another scope or the default registry in the project `.npmrc` still points at `npm.pkg.github.com`, sync keeps the line: those packages still need it.

3. **Reinstall.** Run `pnpm install` and commit `.npmrc` and `pnpm-lock.yaml`. Then, unless the project still installs another scope from GitHub Packages, remove `NODE_AUTH_TOKEN` and `PNPM_CONFIG_NPMRC_AUTH_FILE` from the Cloudflare Workers Builds environment ([deploy-authentication.md](../deploy-authentication.md#after-moving-to-public-npm)).

The project `.npmrc` route takes precedence over a user-level `~/.npmrc` mapping, so other projects on the same machine can stay on GitHub Packages. A global install (`pnpm add -g`) reads only the user-level mapping. To install the global CLI from public npm, remove the `@joshuafolkken:registry` line from `~/.npmrc`.

## 2. Install

```bash
pnpm add -D @joshuafolkken/app-kit
```

app-kit has to be one of the project's `devDependencies`: `josh-app init` wires its presets into the scaffolded `eslint.config.js`, `tsconfig.json`, cspell and lefthook config, and those imports resolve only from there. kit comes with it as a peer, and `pnpm exec josh-app` runs the project's copy. A global install (`pnpm add -g @joshuafolkken/app-kit`) is optional; it lets you type `josh-app` without `pnpm exec`.

> **Version-age gotcha.** A supply-chain safety delay (`minimum-release-age`, 24h) can resolve a bare `pnpm add -g @joshuafolkken/app-kit` to an **older** published version. While the version you want is still inside its 24h window, pin it and skip the age gate:
>
> ```bash
> pnpm add -g @joshuafolkken/app-kit@<version> --safe-chain-skip-minimum-package-age
> ```
>
> Once the target version ages past 24h, a bare `pnpm add -g @joshuafolkken/app-kit` resolves to the latest.

## 3. Set up

From the root of a SvelteKit project:

```bash
pnpm exec josh-app start
pnpm josh gate
```

`josh-app start` runs kit's [`josh start`](https://github.com/joshuafolkken/kit/blob/main/docs/init.md) with `josh-app init` as its setup step: it creates the Git repository if there is none, sets the project up, makes the first commit, creates the GitHub repository and its labels, and — when `main` already has history — opens a pull request with the setup instead. It always uses kit's full profile, which the SvelteKit + Cloudflare overlay needs. Its other options are kit's, passed through unchanged: `--yes` (no prompts), `--github` (consent to the GitHub steps when unattended) and `--public`. It needs `gh` signed in and kit 1.1050.0 or later.

To set up the files only, without Git or GitHub, run `pnpm exec josh-app init` instead. `josh-app init` runs kit's framework-agnostic `josh init` first, then applies the SvelteKit + Cloudflare overlay on top: the managed `package.json` scripts, the SvelteKit config lines, the Cloudflare `wrangler.jsonc` worker name and the seeded files (`_headers`, `zap-baseline.conf`, the security-headers E2E spec and the k6 scenarios). What kit's base creates is described in kit's [init.md](https://github.com/joshuafolkken/kit/blob/main/docs/init.md).

## Next

- Keep it current: [Update app-kit](../how-to/update-app-kit.md).
- Every command: [cli.md](../cli.md).
- Import the runtime features and presets: [package-api.md](../package-api.md).
- Apply the security-header baseline in your server hook: [security-headers.md](../security-headers.md).
