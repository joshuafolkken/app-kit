# Package API

Add app-kit as a devDependency ([setup.md](./setup.md#3-install)), then import the pieces you need. Every entry point is a separate subpath export, so unused features are tree-shaken away.

| Import                                      | Provides                                                         | Details                                                                      |
| ------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `@joshuafolkken/app-kit`                    | Package entry — runtime feature namespaces                       |                                                                              |
| `@joshuafolkken/app-kit/theme`              | `theme_store` and the `Theme` type                               |                                                                              |
| `@joshuafolkken/app-kit/i18n`               | `locale_store` and the `Locale` type                             |                                                                              |
| `@joshuafolkken/app-kit/security`           | `security_headers` — baseline security headers for SSR responses | [security-headers.md](./security-headers.md#apply-the-baseline-to-ssr-pages) |
| `@joshuafolkken/app-kit/security/e2e`       | `security_headers_e2e` — checks for the security-headers E2E     | [security-headers.md](./security-headers.md#the-per-pr-e2e-spec)             |
| `@joshuafolkken/app-kit/eslint/sveltekit`   | SvelteKit ESLint flat-config preset                              |                                                                              |
| `@joshuafolkken/app-kit/tsconfig/sveltekit` | SvelteKit `tsconfig` preset (extend from your `tsconfig.json`)   |                                                                              |
| `@joshuafolkken/app-kit/cspell/sveltekit`   | SvelteKit cspell word/config preset                              |                                                                              |

`josh-app init` wires the three presets in for you. To wire one by hand — for example, the ESLint preset:

```js
// eslint.config.js
import { create_sveltekit_config } from '@joshuafolkken/app-kit/eslint/sveltekit'

export default [
	...create_sveltekit_config({
		gitignore_path: new URL('./.gitignore', import.meta.url),
		tsconfig_root_dir: import.meta.dirname,
	}),
]
```
