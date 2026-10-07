# Deploy-time authentication (Cloudflare Workers Builds)

**This page applies only to a project that installs `@joshuafolkken/*` from GitHub Packages** — one whose `@joshuafolkken:registry` points at `https://npm.pkg.github.com`. A project that installs from public npm builds on Cloudflare Workers Builds with no credential at all ([install.md → Choose the registry](./setup/install.md#1-choose-the-registry)): it needs neither `NODE_AUTH_TOKEN` nor `PNPM_CONFIG_NPMRC_AUTH_FILE` in the build environment, and `josh-app init` / `josh-app sync` add no GitHub Packages line to its `.npmrc`.

A deploy builder has no `~/.npmrc`, so the user-level setup in [install.md](./setup/install.md#authenticate-to-github-packages) does not carry over — the build installs `@joshuafolkken/*` with no credential and fails with `ERR_PNPM_FETCH_401`. When the project `.npmrc` routes the scope there (`@joshuafolkken:registry=https://npm.pkg.github.com`), `josh-app init` / `josh-app sync` therefore keep this line beside it:

```ini
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

## Set both halves in the build environment

**The line alone authenticates nothing.** pnpm ignores credentials that come from a committed project `.npmrc` unless that file is declared a trusted auth file — and the declaration is only honoured from **outside** the repository. Writing `npmrcAuthFile` into the project `.npmrc` itself, or into `pnpm-workspace.yaml`, does not work: a committed file that could vouch for itself would void the protection. So the build environment must supply both halves:

| Kind     | Name                          | Value                           |
| -------- | ----------------------------- | ------------------------------- |
| Secret   | `NODE_AUTH_TOKEN`             | GitHub PAT with `read:packages` |
| Variable | `PNPM_CONFIG_NPMRC_AUTH_FILE` | `.npmrc`                        |

With both set, the credential is expanded and the build authenticates. With only the line present, pnpm prints `[WARN] Ignored project-level auth setting …` on every command and sends no authorization header; setting the variable removes the warning as well.

The line is safe to keep either way — it holds a variable name, never a token — and GitHub Actions is unaffected, since `actions/setup-node` writes its own npmrc.

## After moving to public npm

Once `pnpm josh registry:migrate` has pointed the project `.npmrc` at public npm ([install.md → Move an existing project to public npm](./setup/install.md#move-an-existing-project-to-public-npm)), the next `josh-app sync` removes the line above, and the build needs neither variable. Delete the `NODE_AUTH_TOKEN` secret and the `PNPM_CONFIG_NPMRC_AUTH_FILE` variable from the Workers Builds environment, along with any `npm_config_//npm.pkg.github.com/:_authToken` variable from the alternative below. A build that still has them is unaffected, but the token no longer needs to be stored there.

Exception: the credential is keyed by host, not scope. If the project `.npmrc` still routes another scope (or the default registry) to `npm.pkg.github.com`, sync keeps the line and those packages still authenticate with it — keep whichever GitHub Packages credential the build uses (both variables above, or the `npm_config_//npm.pkg.github.com/:_authToken` variable from the alternative) until that scope moves too.

## Alternative: no repository change

A single build-environment variable named `npm_config_//npm.pkg.github.com/:_authToken`, set to the token, authenticates without any `.npmrc` line and without the warning. To adopt it, comment the project line out — `josh-app sync` treats a commented-out entry as your decision and never re-adds it. Deleting the line outright is not enough; the next sync would restore it.
