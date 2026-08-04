// @ts-nocheck
// k6 scenarios run in k6's own JS runtime, not Node or the browser: the `k6` / `k6/http` module
// specifiers and the `__ENV` global cannot resolve under the app's tsconfig, which type-checks
// `**/*.js` with `checkJs`. The directive above keeps `tsc --noEmit` off this file — the app-kit
// ESLint preset ignores `k6/**` for the same reason. Remove it only if you add `@types/k6`.
import { check } from 'k6'
import http from 'k6/http'

// "Attacking" stress scenario (app-kit#95) — finds the app's throughput ceiling, unlike the gentle
// baseline in load-test.js. Run it explicitly: `josh-app load k6/stress-test.js`.
//
// It drives a ramping ARRIVAL RATE (a target requests/second that k6 adds VUs to sustain) with NO
// sleep, so it pushes real load until latency climbs or errors appear — the point where p(95)
// spikes or http_req_failed rises is your capacity limit. This file is YOURS after the first sync:
// tune the target rates for your app and infrastructure (a laptop preview tops out far below a
// deployed worker). Report-only: no thresholds, so it never fails CI.

const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:4173'

export const options = {
	scenarios: {
		stress: {
			executor: 'ramping-arrival-rate',
			startRate: 50,
			timeUnit: '1s',
			preAllocatedVUs: 50,
			maxVUs: 200,
			// Climb from 50 to 500 req/s, then wind down. Watch p(95) and http_req_failed: the rate
			// at which they turn is the ceiling. Push the targets higher once you find headroom.
			stages: [
				{ target: 200, duration: '20s' },
				{ target: 500, duration: '20s' },
				{ target: 0, duration: '5s' },
			],
		},
	},
}

export default function () {
	const response = http.get(BASE_URL)

	check(response, { 'status is 200': (r) => r.status === 200 })
}
