# The `josh-app` CLI

`josh-app` orchestrates kit's framework-agnostic base first (`josh init` / `josh sync`), then applies the SvelteKit + Cloudflare overlay on top — one command delivers base + overlay. Install it globally ([install.md](./setup/install.md#2-install)) and run it from the root of a SvelteKit project. Inside a project that has app-kit as a devDependency, `pnpm josh-app …` runs the project's copy.

## Commands

| Command                      | What it does                                                               | Details                                         |
| ---------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------- |
| `josh-app start`             | kit's `josh start` (Git, GitHub, setup PR) with `josh-app init` as setup   | [install.md](./setup/install.md#3-set-up)       |
| `josh-app init` / `i`        | Apply kit's base then the SvelteKit + Cloudflare overlay to a project      | [install.md](./setup/install.md#3-set-up)       |
| `josh-app sync` / `sy`       | Re-sync the overlay (scripts, seeds, SvelteKit config lines) idempotently  | [update-app-kit.md](./how-to/update-app-kit.md) |
| `josh-app check` / `c`       | Fast incremental SvelteKit type-check (dev loop)                           |                                                 |
| `josh-app check:ci`          | Strict SvelteKit type-check (CI variant)                                   |                                                 |
| `josh-app dast`              | Dynamic baseline security scan against the running preview server          | [dast.md](./dast.md)                            |
| `josh-app load`              | Manual k6 load test against the running preview server (report-only)       | [load-testing.md](./load-testing.md)            |
| `josh-app load:stress`       | Manual k6 stress test — drives load to find the throughput ceiling         | [load-testing.md](./load-testing.md)            |
| `josh-app shot <route...>`   | Screenshot the given routes against a freshly built, once-booted preview   | [shot.md](./shot.md)                            |
| `josh-app verify`            | Unified pre-push gate: build once, boot once, run E2E + DAST scan together | [verify.md](./verify.md)                        |
| `josh-app version` / `v`     | Report installed-vs-latest version                                         | [The effective kit](#the-effective-kit)         |
| `josh-app version --upgrade` | Upgrade global and project installs to the latest version                  | [The effective kit](#the-effective-kit)         |

`josh-app version` reads the latest version of app-kit and kit from the GitHub Packages versions API through the `gh` CLI, so it needs `gh` signed in with the `read:packages` scope — whichever registry the project installs from ([kit#2882](https://github.com/joshuafolkken/kit/issues/2882) tracks reading it from public npm instead). Each release is published to public npm and GitHub Packages at the same version, so the latest it reports holds for both; `--upgrade` installs from the registry your configuration routes the `@joshuafolkken` scope to.

Run `josh-app --help` (or `josh-app help`) to list commands. The older `josh-app version:upgrade` / `josh-app vu` forms still work. Unsupported arguments fail rather than being silently ignored.

## The effective kit

`josh-app v` also reports the **effective kit** — the `@joshuafolkken/kit` copy the running CLI actually executes. kit is an auto-installed peer of the global app-kit, and pnpm resolves that peer once and pins it in the global install's own lockfile, so a plain `pnpm add -g @joshuafolkken/app-kit` cannot move it. When the effective kit is stale, `vu` therefore reinstalls the global CLI to force a fresh resolution:

```bash
pnpm remove -g @joshuafolkken/app-kit; pnpm add -g @joshuafolkken/app-kit@<version>
```

The two commands are separated by `;` rather than `&&` on purpose: if the reinstall fails, running the same line again still repairs the install. The [release-age gate](./setup/install.md#2-install) applies here too — a fresh resolution picks the newest version older than the delay window, so `v` can still show `⚠` right after a successful `vu`; the outcome line printed by `vu` reports how far the effective kit advanced.
