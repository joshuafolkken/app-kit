# How-to guides

For anyone who knows what they want to do but not which page covers it. For kit's own tasks — running Issues with an agent, updating dependencies, releasing — see kit's [how-to.md](https://github.com/joshuafolkken/kit/blob/main/docs/how-to.md).

## Set up

| I want to…                                                | Guide                                                    |
| --------------------------------------------------------- | -------------------------------------------------------- |
| Add app-kit to a SvelteKit project                        | [Install app-kit](./setup/install.md)                    |
| Install from GitHub Packages on Cloudflare Workers Builds | [Deploy-time authentication](./deploy-authentication.md) |

## Keep up to date

| I want to…                                    | Guide                                        |
| --------------------------------------------- | -------------------------------------------- |
| Upgrade app-kit and pull in its updated files | [Update app-kit](./how-to/update-app-kit.md) |

## Security

| I want to…                                | Guide                                                                                    |
| ----------------------------------------- | ---------------------------------------------------------------------------------------- |
| Send the security headers from SSR pages  | [Apply the baseline to SSR pages](./security-headers.md#apply-the-baseline-to-ssr-pages) |
| Accept or fix a finding from the ZAP scan | [Triage findings](./dast.md#triage-findings-in-zap-baselineconf)                         |

## Verify

| I want to…                         | Guide                                    |
| ---------------------------------- | ---------------------------------------- |
| Run every check before pushing     | [Unified pre-push gate](./verify.md)     |
| Screenshot a route to check the UI | [UI verification screenshots](./shot.md) |
| Load-test the app                  | [Load testing](./load-testing.md)        |
