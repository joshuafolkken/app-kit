import adapter from '@sveltejs/adapter-cloudflare'

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		runes: true,
	},
	vitePlugin: {
		// Our `runes: true` above is global and would also force third-party
		// components under node_modules into runes mode. Some still ship legacy
		// syntax (e.g. `export let`), which is illegal in runes mode and breaks
		// compilation. Let Svelte auto-detect the mode for dependencies instead,
		// so each compiles in its own intended mode while our own code stays runes.
		dynamicCompileOptions({ filename, compileOptions }) {
			if (filename.includes('node_modules') && compileOptions.runes) {
				return { runes: undefined }
			}
		},
	},
	kit: {
		adapter: adapter(),
	},
}

export default config
