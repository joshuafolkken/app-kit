# Deploy-time authentication (Cloudflare Workers Builds)

A deploy builder has no `~/.npmrc`, so the user-level setup in [setup.md](./setup.md#2-authenticate-to-github-packages) does not carry over — the build installs `@joshuafolkken/*` with no credential and fails with `ERR_PNPM_FETCH_401`. `josh-app init` / `josh-app sync` therefore keep this line in the project `.npmrc`:

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

## Alternative: no repository change

A single build-environment variable named `npm_config_//npm.pkg.github.com/:_authToken`, set to the token, authenticates without any `.npmrc` line and without the warning. To adopt it, comment the project line out — `josh-app sync` treats a commented-out entry as your decision and never re-adds it. Deleting the line outright is not enough; the next sync would restore it.
