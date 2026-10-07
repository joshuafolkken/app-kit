# Why app-kit exists

[kit](https://github.com/joshuafolkken/kit) makes an AI agent safe to hand work to in any project — [its story](https://github.com/joshuafolkken/kit/blob/main/docs/why.md) covers that. A SvelteKit app on Cloudflare brings snags of its own on top, and app-kit is what came out of fixing them once instead of in every project. Read only the sections that sound familiar.

## I keep repeating the same instructions

### Sound familiar?

You wrote it in the rules file and it still isn't followed, so you write it again in more detail. The file grows until **nobody reads it, and it eats the context.**

### What kit does

**The rules file says only when a rule fires and where its details live.** The procedures live outside it, as skills loaded only when that work begins, and `josh sync` brings every project up to the latest rules — you say it once, in one place. app-kit includes all of it. → [kit's full story](https://github.com/joshuafolkken/kit/blob/main/docs/why.md#i-keep-repeating-the-same-instructions)

## Wiring AI up to GitHub is a chore

### Sound familiar?

Branch, push, open a PR, link the Issue, wait for CI, merge, close the Issue. Getting an agent to do all of that reliably means **writing your own scripts and prompts — again, in every repository.**

### What kit does

**One keyword covers the whole path.** `fullrun` goes Issue → branch → PR → merge, and merges only when CI is green. app-kit includes all of it, and `josh-app start` sets the workflow up together with the SvelteKit project. → [kit's full story](https://github.com/joshuafolkken/kit/blob/main/docs/why.md#wiring-ai-up-to-github-is-a-chore)

## Setting up SvelteKit on Cloudflare takes a day

### Sound familiar?

A new SvelteKit project, then the Cloudflare adapter, Wrangler config, lint and TypeScript presets, Playwright, security headers, Git hooks, the GitHub repository. **Each step is small; together they eat the first day — and the next project repeats it.**

### What app-kit does

**One command sets up the whole project.** `josh-app start` runs kit's base setup, applies the SvelteKit + Cloudflare overlay on top, makes the first commit and creates the GitHub repository (or opens a setup pull request when `main` already exists). After an upgrade, `josh-app sync` re-applies both layers — it overwrites what app-kit manages and never the files you own. → [Install app-kit](./setup/install.md)

## I'm not sure the app is secure

### Sound familiar?

The static scanners are green, but **none of them ever started the app.** Missing security headers, an unset CSP or a cookie without `Secure` only show up in a running server's responses.

### What app-kit does

**Secure defaults, checked against the running app.**

- **A header baseline**: `josh-app sync` seeds it for static assets, one server hook applies it to SSR pages, and SvelteKit emits a Content-Security-Policy with a per-request nonce (a hash on prerendered pages).
- **Checked on every PR**: an E2E spec asserts the headers and that the page renders with no CSP violation.
- **Scanned nightly**: an OWASP ZAP baseline scan runs against a real preview server — and before a push that touches a header- or cookie-affecting file.

→ [Security headers](./security-headers.md) · [Security scanning (DAST)](./dast.md)

## Nobody looked at the screen

### Sound familiar?

The tests pass and the agent reports "done" — and **the page is broken.** A green test run stood in for a look at the page, because there was no easy way to take one.

### What app-kit does

**`josh-app shot` takes the look.** Give it the routes you changed: it builds once, boots the preview once, drives a real browser over every route and saves a screenshot of each. A route that answers with an error fails the command instead of photographing the error page. → [UI verification screenshots](./shot.md)

## E2E rebuilds the app again and again

### Sound familiar?

E2E builds the app and boots a preview. The security scan builds it and boots another. **The same build runs twice before every push**, or two servers collide on one port.

### What app-kit does

**One pre-push gate builds once.** `josh-app verify` builds the app, boots one preview, runs Playwright — and the ZAP scan when a header-affecting file changed — against that single server, and tears it down. → [Unified pre-push gate](./verify.md)

## I don't know if it holds up under load

### Sound familiar?

It is fast on your machine with one user. **What happens with a hundred is a guess.**

### What app-kit does

**`josh-app load` measures it.** It builds the app, boots the preview and runs a [k6](https://grafana.com/docs/k6/) scenario against it, reporting latency and throughput. It is not part of the pre-push gate, so a slow result never blocks a push; add k6 thresholds when you want one to fail the run. → [Load testing](./load-testing.md)

## Starting a 3D game means building it all first

### Sound familiar?

You want to try a game idea, but **the scene, the player, the controls and the state all have to exist before the idea can be played.**

### What game-kit does

**[game-kit](https://github.com/joshuafolkken/game-kit) builds on app-kit and starts you from a working game.** `josh-game init` scaffolds a SvelteKit + [Threlte](https://threlte.xyz/) project, and its library supplies drop-in scenes, player, controls and state. → [game-kit install](https://github.com/joshuafolkken/game-kit/blob/main/docs/install.md)

## What to know up front

- **It is for SvelteKit on Cloudflare.** Any other stack is better served by kit on its own.
- **Some checks need tools on your machine**: Docker for the ZAP scan — including the pre-push run when a header- or cookie-affecting file changes — and k6 for the load test.
- **Everything kit does comes with it.** app-kit builds on kit, so its rules, checks and Issue workflow apply unchanged.
