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

## Confirmed on 2026-11-16

A person set up Workers Builds from this file on 2026-11-16. The build logs confirmed these:

- **Build image** — Workers Builds provides the versions `package.json` requires (`devEngines.packageManager` with `onFail: download`, `engines.node` with `engineStrict: true`). Log: `Detected the following tools from environment: pnpm@12.21.0, nodejs@24.22.1`.
- **Build authentication** — the install needs no token. With no token variable set, the build installed `@joshuafolkken/kit@1.3143.0` from public npm and went on to `Executing user build command: pnpm run build`.
- **Custom Domain** — the first successful deploy attached `app-kit.joshuafolkken.com` without a dashboard step. Log: `app-kit.joshuafolkken.com (custom domain)`.
- **Preview command** — the preview build runs `pnpm exec wrangler preview` (an open beta command in wrangler 4.162.0), which needs a `previews` block in `wrangler.jsonc`. Without one it stops with `Your Wrangler configuration is missing a previews block`; the error text says an empty block is enough, so `wrangler.jsonc` carries `"previews": {}`.

## Assumptions not yet confirmed

These have not been checked on the Cloudflare side. The verification Issue confirms or corrects each one, then this list is updated.

- **Existing setup** — whether an `app-kit` Worker, a Workers Builds connection or a DNS record for `app-kit.joshuafolkken.com` already exists. On 2026-09-25 the host did not resolve.
- **Dashboard paths** — the **Set up your application** fields in step 2 match the screen as of 2026-11-16. The menu paths and the **Settings** field names are written from Cloudflare's documentation, not from this account; the person setting up notes any that differ.
- **Production branch setting** — which screen and field change the production branch after the Worker exists. Step 3 assumes **app-kit → Settings → Build → Branch control**.
- **API token** — which choice the creation screen's **API token** field needs. Step 2 assumes the default the screen offers.

## Build authentication

None. app-kit installs `@joshuafolkken` packages from public npm, so the build needs no token ([confirmed](#confirmed-on-2026-11-16)). Remove any GitHub Packages variables left from before the move: [deploy-authentication.md → After moving to public npm](../deploy-authentication.md#after-moving-to-public-npm).

## Initial setup (a person)

Prerequisites: admin access to the Cloudflare account that holds the `joshuafolkken.com` zone, and owner access to `joshuafolkken/app-kit` on GitHub. Merge [#23](https://github.com/joshuafolkken/app-kit/issues/23) first. Never paste a secret value into an Issue, a pull request or this file.

1. **Check what exists.** Cloudflare dashboard → **Workers & Pages**: look for an `app-kit` Worker and its **Settings → Build** connection. Then **joshuafolkken.com → DNS → Records**: look for a record named `app-kit`. If the host points at another service, decide whether to switch it before going on. If a working connection already exists, keep it and change only what differs from the steps below.
2. **Create the Worker.** If no `app-kit` Worker exists: **Workers & Pages → Create → Import a repository**, install or update the **Cloudflare Workers and Pages** GitHub App with access to `joshuafolkken/app-kit` and select the repository. The **Set up your application** screen has no branch field: creating the Worker builds and deploys the default branch (`main`) once, and step 3 changes the production branch afterwards. Set:

   | Field                         | Value                                                                        |
   | ----------------------------- | ---------------------------------------------------------------------------- |
   | Project name                  | `app-kit`                                                                    |
   | Build command                 | `pnpm build`                                                                 |
   | Deploy command                | `pnpm exec wrangler deploy` — replace the default                            |
   | Preview command               | `pnpm exec wrangler preview`                                                 |
   | Enable Preview builds         | on                                                                           |
   | Advanced settings → Path      | `/`                                                                          |
   | Advanced settings → API token | the default the screen offers ([assumption](#assumptions-not-yet-confirmed)) |

   The default deploy command `npx wrangler deploy` fails: npm rejects the `pnpm` entry in `package.json`'s `devEngines.packageManager` with `EBADDEVENGINES`. Leave **Variable name** and **Variable value** empty. If the dashboard offers a switch from the old preview model, read what it changes before accepting.

   If the Worker exists: **app-kit → Settings → Build → Connect**, and set the same commands there.

3. **Switch the production branch.** **app-kit → Settings → Build → Branch control** ([assumption](#assumptions-not-yet-confirmed)): set the production branch to `production`. Do not start a build by hand until a release reaches `production`. As of 2026-11-16, `production` predates the move to public npm ([#306](https://github.com/joshuafolkken/app-kit/issues/306) / [#307](https://github.com/joshuafolkken/app-kit/issues/307)): its `.npmrc` installs `@joshuafolkken` from GitHub Packages, so a build of it fails at install. The next release tag deploys on its own.
4. **Check variables and secrets.** **Settings → Build → Variables and secrets**: `NODE_AUTH_TOKEN` and `PNPM_CONFIG_NPMRC_AUTH_FILE` are not needed; delete them if present. Check that preview builds get no production-only secret or binding.
5. **Attach the domain.** The `custom_domain` route in `wrangler.jsonc` attaches `app-kit.joshuafolkken.com` on the first production deploy ([confirmed](#confirmed-on-2026-11-16)). If a conflicting DNS record blocks it, change the record after the decision in step 1, or attach it from **app-kit → Settings → Domains & Routes → Add → Custom domain**.
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
- **Production** — after a release reaches the `production` branch, Workers Builds deploys that commit. Open `https://app-kit.joshuafolkken.com` and check the site renders and the response carries the security headers ([security-headers.md](../security-headers.md)).
- **Finish** — replace the assumptions above with the confirmed settings.

## When it fails

| Symptom                                    | Where to look                                                                                                                         |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Build or deploy fails                      | **app-kit → Deployments → View build** (build log); the Cloudflare bot comment on the pull request                                    |
| Deploy fails with `EBADDEVENGINES`         | The deploy command is still the default `npx wrangler deploy`; set `pnpm exec wrangler deploy` (step 2)                               |
| Preview fails: missing a `previews` block  | `wrangler.jsonc` lost its `"previews": {}` — [Preview command](#confirmed-on-2026-11-16)                                              |
| Install fails on pnpm or Node version      | The build log's install step — see [Build image](#confirmed-on-2026-11-16)                                                            |
| Install fails with 401 / 403               | A leftover GitHub Packages route — [Build authentication](#build-authentication); a `production` commit from before the move — step 3 |
| Domain does not attach or does not resolve | **Settings → Domains & Routes**; **joshuafolkken.com → DNS → Records**                                                                |
| Site deploys but errors at runtime         | **app-kit → Observability → Logs** (logs and traces are on in `wrangler.jsonc`)                                                       |
| Release tag does not reach `production`    | The `production.yml` run under the repository's **Actions** tab                                                                       |
