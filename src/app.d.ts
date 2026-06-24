/// <reference path="../worker-configuration.d.ts" />
// See https://svelte.dev/docs/kit/types#app.d.ts
// The reference pulls in the wrangler-generated Cloudflare types (Env, ExecutionContext,
// …) regardless of tsconfig `include` scope, which a src-scoped include would otherwise
// miss for the root-level worker-configuration.d.ts.
declare global {
	namespace App {
		interface Platform {
			env: Env
			ctx: ExecutionContext
			caches: CacheStorage
			cf?: IncomingRequestCfProperties
		}

		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
	}
}

export {}
