// @ts-nocheck
// k6 scenarios run in k6's own JS runtime, not Node or the browser: the `k6` / `k6/http` module
// specifiers and the `__ENV` global cannot resolve under the app's tsconfig, which type-checks
// `**/*.js` with `checkJs`. The directive above keeps `tsc --noEmit` off this file — the app-kit
// ESLint preset ignores `k6/**` for the same reason. Remove it only if you add `@types/k6`.
import { check, sleep } from 'k6'
import http from 'k6/http'

// k6 load-test scenario — distributed by `josh-app sync` as a starting point (app-kit#95).
// This file is YOURS after the first sync: tune the VUs, duration, and the endpoints it exercises
// for your app.
//
// Report-only by design: it defines NO thresholds, so the run always exits 0 and surfaces
// latency / throughput numbers without failing CI on an uncalibrated baseline. Add a `thresholds`
// block (e.g. `http_req_duration: ['p(95)<500']`) once a few runs have given you a real baseline.
//
// The target comes from BASE_URL (`josh-app load` points it at the preview server on :4173); the
// fallback lets `k6 run k6/load-test.js` work standalone against a local preview.

const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:4173'

export const options = {
	// A short, gentle ramp: long enough to produce a usable p95, brief enough that `josh-app load`
	// stays a "run it while you work" command rather than a multi-minute wait.
	stages: [
		{ duration: '10s', target: 5 },
		{ duration: '20s', target: 5 },
		{ duration: '5s', target: 0 },
	],
}

export default function () {
	const response = http.get(BASE_URL)

	check(response, { 'status is 200': (r) => r.status === 200 })

	sleep(1)
}
