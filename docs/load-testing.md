# Load testing (k6)

`josh-app load` measures how the app behaves under load. It builds the project, boots the preview server, runs a [k6](https://grafana.com/docs/k6/) scenario against it, and tears the server down — reusing the same build/boot/teardown path as `dast` and `verify` (one preview, not a second implementation). It reports latency and throughput; it is **not** a pass/fail gate.

**Prerequisite: k6 on `PATH`.** Unlike the ZAP scan (Docker), the load test runs the k6 binary directly — install it first (`brew install k6`, or see the [k6 install docs](https://grafana.com/docs/k6/latest/set-up/install-k6/)). A missing k6 fails the command with an actionable message rather than skipping silently.

```bash
pnpm josh-app load          # build → boot preview → run the baseline k6/load-test.js → tear down
pnpm josh-app load:stress   # same lifecycle, but run the "attacking" k6/stress-test.js instead
```

## The two scenarios are yours

`josh-app sync` seeds a gentle **`k6/load-test.js`** (baseline: a few VUs with think-time, for a stable p95 and regression tracking) and an **`k6/stress-test.js`** (a ramping arrival-rate probe with no think-time, to find the throughput ceiling — where p95 spikes or errors appear is your limit). Each is seeded once and never rewritten — VUs, duration, rates, and the exercised endpoints are project-specific, so tune them for your app.

The one line `josh-app sync` does keep is the `// @ts-nocheck` header. The scenarios target k6's own JS runtime, so a project whose `tsconfig.json` type-checks `**/*.js` cannot compile them (the `k6` / `k6/http` imports and `__ENV` do not resolve) — the directive keeps `tsc --noEmit` off them, exactly as the app-kit ESLint preset already ignores `k6/**`. Sync adds it to a scenario seeded by an earlier version and otherwise leaves your tuning untouched. Delete it only if you add `@types/k6`.

## Pick a scenario per run

`josh-app load` runs the baseline and `josh-app load:stress` runs the stress scenario; to run **your own**, pass its path: `josh-app load path/to/scenario.js`. Every scenario reads its target from `__ENV.BASE_URL`, which the command points at the preview port — so the same file can also run standalone against a deployed URL: `k6 run -e BASE_URL=https://your-app.workers.dev k6/load-test.js`.

## Report-only by default

The seeded scenario defines **no thresholds**, so a run always exits 0 and surfaces numbers without failing on an uncalibrated baseline. Add a `thresholds` block (e.g. `http_req_duration: ['p(95)<500']`) once a few runs have given you a real baseline — k6 then exits non-zero when a threshold is breached.

## Runs manually, not per-PR and not on a schedule

Unlike `dast.yml` (a deterministic pass/fail that runs nightly), a load test reports numbers that need a baseline to interpret, and noisy CI runners make an uncalibrated scheduled run decay into noise. So the distributed `load.yml` triggers on **`workflow_dispatch`** only (the Actions "Run workflow" button), with the `schedule:` block shipped **commented out** — uncomment it once your app has a real workload and a calibrated baseline. It is also deliberately **not** a `lefthook` hook: a minutes-long push step invites `--no-verify`. Like `dast.yml`, `load.yml` is a **separate, additive** workflow that never touches `ci.yml` ([dast.md → Seeded files and managed workflows](./dast.md#seeded-files-and-managed-workflows)).
