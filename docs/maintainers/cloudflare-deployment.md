# Deploying the app-kit site (Cloudflare Workers Builds)

For app-kit maintainers: how the app-kit site reaches Cloudflare Workers, and how to rebuild the Cloudflare side from scratch. Cloudflare Workers Builds builds and deploys the repository; GitHub Actions does not deploy.

| Setting           | Value                                                                                             | Source           |
| ----------------- | ------------------------------------------------------------------------------------------------- | ---------------- |
| Worker name       | `app-kit`                                                                                         | `wrangler.jsonc` |
| Custom Domain     | `app-kit.joshuafolkken.com`                                                                       | `wrangler.jsonc` |
| workers.dev       | `https://app-kit.joshuafolkken.workers.dev`                                                       | `wrangler.jsonc` |
| Repository        | `joshuafolkken/app-kit`                                                                           | —                |
| Production branch | `production` — `main` from creation until [the switch](#switching-the-production-branch-a-person) | Workers Builds   |
| Release flow      | a release tag → `production` branch (`production.yml`)                                            | kit-distributed  |
| Preview           | every push to any other branch, `main` included, separate from production                         | Workers Builds   |

A person does the Cloudflare side in two parts, at different times. Both need account permissions, so a run never does them.

1. **[Initial setup](#initial-setup-a-person)** — once: create the Worker and get a first successful deploy. The site is published from `main`.
2. **[Switching the production branch](#switching-the-production-branch-a-person)** — publish from `production` instead of `main`. Done on 2026-11-16; no release has reached `production` since ([#317](https://github.com/joshuafolkken/app-kit/issues/317)).

A run checks the result from what the person records on the Issue ([Verification](#verification-a-run)).

## Confirmed on 2026-11-16

A person set up Workers Builds from this file on 2026-11-16 and checked the result ([#313](https://github.com/joshuafolkken/app-kit/issues/313)). The build logs, the GitHub checks and the person confirmed these:

- **Build image** — Workers Builds provides the versions `package.json` requires (`devEngines.packageManager` with `onFail: download`, `engines.node` with `engineStrict: true`). Log: `Detected the following tools from environment: pnpm@12.21.0, nodejs@24.22.1`.
- **Build authentication** — the install needs no token. With no token variable set, the build installed `@joshuafolkken/kit@1.3143.0` from public npm and went on to `Executing user build command: pnpm run build`. **Settings → Build → Variables and secrets** holds no token variable.
- **Production branch** — the creation screen has no branch field; the Worker's first build deployed the default branch, `main`. The person then switched the production branch to `production`.
- **Other branches run the preview command** — after the switch every branch but the production branch, `main` included, runs `pnpm exec wrangler preview`. The build of `main` at `2fd1e9d` logged `Executing user deploy command: pnpm exec wrangler preview` and `Preview: main (updated)`, updating `https://main-app-kit.joshuafolkken.workers.dev`; production did not change. A green `Workers Builds: app-kit` check on such a commit is a preview's success, not a production deploy's; its build link runs under `…/app-kit/production/previews/<branch>/builds/…`.
- **Custom Domain** — the first successful deploy attached `app-kit.joshuafolkken.com` without a dashboard step. Log: `app-kit.joshuafolkken.com (custom domain)`. The site renders at `https://app-kit.joshuafolkken.com/` — checked on version `4ae2bc61`, built from `main` before the switch. It does not hold [#318](https://github.com/joshuafolkken/app-kit/pull/318) or anything merged later.
- **Logs** — **Observability → Logs** showed no error caused by the deploy.
- **Preview command** — the preview build runs `pnpm exec wrangler preview` (an open beta command in wrangler 4.162.0), which needs a `previews` block in `wrangler.jsonc`. Without one it stops with `Your Wrangler configuration is missing a previews block`; the error text says an empty block is enough, so `wrangler.jsonc` carries `"previews": {}`.
- **Preview comment** — on a pull request ([#318](https://github.com/joshuafolkken/app-kit/pull/318)) the `cloudflare-workers-and-pages` bot comments with the build result and two URLs: the branch preview `https://<branch>-app-kit.joshuafolkken.workers.dev` and the version preview `https://<id>-app-kit.joshuafolkken.workers.dev`. Each push to the branch updates the comment.
- **Branch preview after the merge** — after #318 merged, its branch preview URL answered `There is nothing here yet`, and its preview page in the dashboard answered `We can't find the page you're looking for.` Whether it rendered while the pull request was open was not checked, so a person checks a preview while its pull request is open.
- **Deployments** — **Deployments** shows no commit SHA. Each row has an 8-character version ID (`4ae2bc61` was active on 2026-11-16), the commit message, the source (`Build` or `Dashboard`), the branch and the age. Match a deployment to a build by branch, time and the build link.
- **Worker tabs** — **app-kit** has the tabs **Overview**, **Metrics**, **Deployments**, **Observability**, **Issues**, **Domains**, **Access** and **Settings**.

## Assumptions not yet confirmed

These have not been checked on this account. Whoever checks one moves it to [Confirmed](#confirmed-on-2026-11-16).

- **Menu paths** — **Settings → Build**, **Settings → Build → Connect** and **Settings → Domains & Routes** are written from Cloudflare's documentation. Domains also appear as the [**Domains** tab](#confirmed-on-2026-11-16); whether **Settings** has the same entry was not checked.
- **Production branch setting** — the person switched the branch on 2026-11-16, but the screen and field were not recorded. [Switching the production branch](#switching-the-production-branch-a-person) assumes **app-kit → Settings → Build → Branch control**.
- **API token** — the creation screen selected a token named `app-kit build token`. How it was created, and whether the screen offers one by default, was not checked.

## Build authentication

None. app-kit installs `@joshuafolkken` packages from public npm, so the build needs no token ([confirmed](#confirmed-on-2026-11-16)). Remove any GitHub Packages variables left from before the move: [deploy-authentication.md → After moving to public npm](../deploy-authentication.md#after-moving-to-public-npm).

## Initial setup (a person)

Prerequisites: admin access to the Cloudflare account that holds the `joshuafolkken.com` zone, and owner access to `joshuafolkken/app-kit` on GitHub. Merge [#23](https://github.com/joshuafolkken/app-kit/issues/23) first. Never paste a secret value into an Issue, a pull request or this file.

1. **Check what exists.** Cloudflare dashboard → **Workers & Pages**: look for an `app-kit` Worker and its **Settings → Build** connection. Then **joshuafolkken.com → DNS → Records**: look for a record named `app-kit`. If the host points at another service, decide whether to switch it before going on. If a working connection already exists, keep it and change only what differs from the steps below.
2. **Create the Worker.** If no `app-kit` Worker exists: **Workers & Pages → Create → Import a repository**, install or update the **Cloudflare Workers and Pages** GitHub App with access to `joshuafolkken/app-kit` and select the repository. The **Set up your application** screen has no branch field: the Worker builds and deploys the default branch, `main`. Set:

   | Field                          | Value                                                                              |
   | ------------------------------ | ---------------------------------------------------------------------------------- |
   | Project name                   | `app-kit`                                                                          |
   | Build command                  | `pnpm run build`                                                                   |
   | Deploy command                 | `pnpm exec wrangler deploy` — replace the default                                  |
   | Preview command                | `pnpm exec wrangler preview`                                                       |
   | Enable Preview builds          | on                                                                                 |
   | Protect with Cloudflare Access | off                                                                                |
   | Advanced settings → Path       | `/`                                                                                |
   | Advanced settings → API token  | `app-kit build token` on 2026-11-16 ([assumption](#assumptions-not-yet-confirmed)) |

   The default deploy command `npx wrangler deploy` fails: npm rejects the `pnpm` entry in `package.json`'s `devEngines.packageManager` with `EBADDEVENGINES`. Leave **Variable name** and **Variable value** empty. If the dashboard offers a switch from the old preview model, read what it changes before accepting.

   If the Worker exists: **app-kit → Settings → Build → Connect** ([assumption](#assumptions-not-yet-confirmed)), and set the same commands there.

3. **Check variables and secrets.** **Settings → Build → Variables and secrets**: `NODE_AUTH_TOKEN` and `PNPM_CONFIG_NPMRC_AUTH_FILE` are not needed; delete them if present. Check that preview builds get no production-only secret or binding.
4. **Attach the domain.** The `custom_domain` route in `wrangler.jsonc` attaches `app-kit.joshuafolkken.com` on the first production deploy ([confirmed](#confirmed-on-2026-11-16)). If a conflicting DNS record blocks it, change the record after the decision in step 1, or attach it from **app-kit → Settings → Domains & Routes → Add → Custom domain** ([assumption](#assumptions-not-yet-confirmed)).
5. **Check the deploy.** While `main` is the production branch: the `main` head has a green `Workers Builds: app-kit` check on GitHub, **Deployments** has a `Build` row on branch `main`, `https://app-kit.joshuafolkken.com/` renders, and **Observability → Logs** shows no error caused by the deploy.
6. **Record the result** on the Issue — see [What to record](#what-to-record).

## Switching the production branch (a person)

Do this when a release is ready to publish. Until then the site is published from `main`. The screen and field names here are [assumptions](#assumptions-not-yet-confirmed) until [#317](https://github.com/joshuafolkken/app-kit/issues/317) confirms them.

1. **Switch the branch.** **app-kit → Settings → Build → Branch control**: set the production branch to `production`. From then on a `main` push runs the preview command and updates the `main` preview, not the site ([confirmed](#confirmed-on-2026-11-16)); the site keeps the last version deployed from `main`.
2. **Wait for a release.** Do not start a build by hand until a release reaches `production`. As of 2026-11-16, `production` predates the move to public npm ([#306](https://github.com/joshuafolkken/app-kit/issues/306) / [#307](https://github.com/joshuafolkken/app-kit/issues/307)): its `.npmrc` installs `@joshuafolkken` from GitHub Packages, so a build of it fails at install. The next release tag deploys on its own.
3. **Check the deploy.** The `production` head has a green `Workers Builds: app-kit` check whose build link has no `previews/` segment, the active deployment on **Deployments** is a `Build` row on branch `production` from the time of that build, and `https://app-kit.joshuafolkken.com/` renders.
4. **Record the result** on the Issue — see [What to record](#what-to-record).

## What to record

Write these on the Issue the run works from. No secret values.

- Worker name
- Connected repository and production branch
- Build, deploy and preview commands as set
- Custom Domain and its state (active, pending, or the error)
- DNS records changed, if any
- The latest build's URL, or its error text
- Which [assumptions](#assumptions-not-yet-confirmed) turned out true or false

## Verification (a run)

The run reads what GitHub shows and what the person recorded. It cannot open the site or the dashboard, so a person checks those.

- **Preview** — the pull request has a `Workers Builds: app-kit` check and the Cloudflare bot comment with the build result and the branch and version preview URLs. A person opens the branch preview URL while the pull request is open and checks the site renders.
- **Production** — the production branch head has a green `Workers Builds: app-kit` check; a green check on any other branch is only a preview. A person matches the active deployment on **Deployments** to that build by branch and time, opens `https://app-kit.joshuafolkken.com/` and checks the site renders and the response carries the security headers ([security-headers.md](../security-headers.md)).
- **Finish** — move each checked assumption to [Confirmed](#confirmed-on-2026-11-16).

## When it fails

| Symptom                                    | Where to look                                                                                                                                                                                                      |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Build or deploy fails                      | **app-kit → Deployments → View build** (build log); the Cloudflare bot comment on the pull request                                                                                                                 |
| Deploy fails with `EBADDEVENGINES`         | The deploy command is still the default `npx wrangler deploy`; set `pnpm exec wrangler deploy` (step 2)                                                                                                            |
| Preview fails: missing a `previews` block  | `wrangler.jsonc` lost its `"previews": {}` — [Preview command](#confirmed-on-2026-11-16)                                                                                                                           |
| Install fails on pnpm or Node version      | The build log's install step — see [Build image](#confirmed-on-2026-11-16)                                                                                                                                         |
| Install fails with 401 / 403               | A leftover GitHub Packages route — [Build authentication](#build-authentication); a `production` commit from before the move — [Switching the production branch](#switching-the-production-branch-a-person) step 2 |
| A merge to `main` does not change the site | Expected once the production branch is `production`: the build log reads `Executing user deploy command: pnpm exec wrangler preview` — [Other branches run the preview command](#confirmed-on-2026-11-16)          |
| Domain does not attach or does not resolve | **Settings → Domains & Routes**; **joshuafolkken.com → DNS → Records**                                                                                                                                             |
| Site deploys but errors at runtime         | **app-kit → Observability → Logs** (logs and traces are on in `wrangler.jsonc`)                                                                                                                                    |
| Release tag does not reach `production`    | The `production.yml` run under the repository's **Actions** tab                                                                                                                                                    |
