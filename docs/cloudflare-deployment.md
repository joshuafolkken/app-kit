# Deploying the app-kit site (Cloudflare Workers Builds)

For app-kit maintainers: how the app-kit site reaches Cloudflare Workers, and how to rebuild the Cloudflare side from scratch. Cloudflare Workers Builds builds and deploys the repository; GitHub Actions does not deploy.

| Setting       | Value                                                    | Source           |
| ------------- | -------------------------------------------------------- | ---------------- |
| Worker name   | `app-kit`                                                | `wrangler.jsonc` |
| Custom Domain | `app-kit.joshuafolkken.com`                              | `wrangler.jsonc` |
| Repository    | `joshuafolkken/app-kit`                                  | —                |
| Release flow  | a release tag → `production` branch (`production.yml`)   | kit-distributed  |
| Preview       | every pull request branch push, separate from production | Workers Builds   |

The work is split in two:

1. **A person sets up Cloudflare and GitHub** ([Initial setup](#initial-setup-a-person)). It needs account permissions, so a run never does it.
2. **A run verifies the result** ([Verification](#verification-a-run)) from what the person records on the verification Issue ([#313](https://github.com/joshuafolkken/app-kit/issues/313)).

## Assumptions not yet confirmed

These have not been checked on the Cloudflare side. The verification Issue confirms or corrects each one, then this list is updated.

- **Existing setup** — whether an `app-kit` Worker, a Workers Builds connection or a DNS record for `app-kit.joshuafolkken.com` already exists. On 2026-09-25 the host did not resolve.
- **Build image** — whether Workers Builds provides pnpm 12.21.0 and Node.js 22.22 or later. `package.json` requires both strictly (`devEngines.packageManager` with `onFail: error`, `engines.node` with `engineStrict: true`), so an older image fails at install.
- **Dashboard paths** — the menu and field names below are written from Cloudflare's documentation, not from this account; the person setting up notes any that differ.
- **Preview command** — whether `pnpm exec wrangler preview` is the preview command the current Workers Builds preview model expects.

## Build authentication

None. app-kit installs `@joshuafolkken` packages from public npm, so the build needs no token. Remove any GitHub Packages variables left from before the move: [deploy-authentication.md → After moving to public npm](./deploy-authentication.md#after-moving-to-public-npm).

## Initial setup (a person)

Prerequisites: admin access to the Cloudflare account that holds the `joshuafolkken.com` zone, and owner access to `joshuafolkken/app-kit` on GitHub. Merge [#23](https://github.com/joshuafolkken/app-kit/issues/23) first. Never paste a secret value into an Issue, a pull request or this file.

1. **Check what exists.** Cloudflare dashboard → **Workers & Pages**: look for an `app-kit` Worker and its **Settings → Build** connection. Then **joshuafolkken.com → DNS → Records**: look for a record named `app-kit`. If the host points at another service, decide whether to switch it before going on. If a working connection already exists, keep it and change only what differs from the steps below.
2. **Connect the repository.** If no `app-kit` Worker exists: **Workers & Pages → Create → Import a repository**, install or update the **Cloudflare Workers and Pages** GitHub App with access to `joshuafolkken/app-kit`, select the repository and name the Worker `app-kit`. If the Worker exists: **app-kit → Settings → Build → Connect**.
3. **Set the build.** **app-kit → Settings → Build**:

   | Field                   | Value                       |
   | ----------------------- | --------------------------- |
   | Git branch (production) | `production`                |
   | Build command           | `pnpm build`                |
   | Deploy command          | `pnpm exec wrangler deploy` |
   | Root directory          | `/`                         |

   Turn on **Builds for non-production branches** (preview builds) and set the non-production deploy command to `pnpm exec wrangler preview`. If the dashboard offers a switch from the old preview model, read what it changes before accepting.

4. **Check variables and secrets.** **Settings → Build → Variables and secrets**: `NODE_AUTH_TOKEN` and `PNPM_CONFIG_NPMRC_AUTH_FILE` are not needed; delete them if present. Check that preview builds get no production-only secret or binding.
5. **Attach the domain.** The `custom_domain` route in `wrangler.jsonc` attaches `app-kit.joshuafolkken.com` on the first production deploy. If a conflicting DNS record blocks it, change the record after the decision in step 1, or attach it from **app-kit → Settings → Domains & Routes → Add → Custom domain**.
6. **Record the result** on the verification Issue — see [What to record](#what-to-record).

## What to record

Write these on the verification Issue ([#313](https://github.com/joshuafolkken/app-kit/issues/313)). No secret values.

- Worker name
- Connected repository and production branch
- Build, deploy and preview commands as set
- Custom Domain and its state (active, pending, or the error)
- DNS records changed, if any
- The latest build's URL, or its error text
- Which [assumptions](#assumptions-not-yet-confirmed) turned out true or false

## Verification (a run)

The verification Issue's run does this after the record above exists.

- **Preview** — push to a pull request branch. The Cloudflare bot comments on the pull request with the build result, the build log and the commit and branch preview URLs. Open the preview URL and check the site renders.
- **Production** — after a release reaches the `production` branch, Workers Builds deploys that commit. Open `https://app-kit.joshuafolkken.com` and check the site renders and the response carries the security headers ([security-headers.md](./security-headers.md)).
- **Finish** — replace the assumptions above with the confirmed settings.

## When it fails

| Symptom                                    | Where to look                                                                                      |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| Build or deploy fails                      | **app-kit → Deployments → View build** (build log); the Cloudflare bot comment on the pull request |
| Install fails on pnpm or Node version      | The build log's install step — see [Build image](#assumptions-not-yet-confirmed)                   |
| Install fails with 401 / 403               | A leftover GitHub Packages route — [Build authentication](#build-authentication)                   |
| Domain does not attach or does not resolve | **Settings → Domains & Routes**; **joshuafolkken.com → DNS → Records**                             |
| Site deploys but errors at runtime         | **app-kit → Observability → Logs** (logs and traces are on in `wrangler.jsonc`)                    |
| Release tag does not reach `production`    | The `production.yml` run under the repository's **Actions** tab                                    |
