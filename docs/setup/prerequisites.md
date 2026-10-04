# Install the prerequisites

The tools the [Quick start](../../README.md#quick-start) needs: **Node.js 22.19.0 or later** (kit's `engines.node`, which every app-kit project installs), **pnpm**, **a POSIX shell** and the **gh CLI**. Then continue with [Install app-kit](./install.md).

## 1. Check what you have

```bash
node --version   # v22.19.0 or later
pnpm --version
gh --version
```

app-kit never installs or replaces a machine-wide Node.js, pnpm or gh. To install Node.js and pnpm, follow kit's [Install the prerequisites](https://github.com/joshuafolkken/kit/blob/main/docs/setup/prerequisites.md#2-install-pnpm-and-nodejs).

## 2. Use a POSIX shell

The `package.json` scripts app-kit distributes are written for `sh`: `dev` and `preview` resolve their port with `$(josh port …)`, and the `prepare` chain gates on `[ … ]` and `command -v`. `cmd.exe` has none of that, so on Windows run them from WSL or Git Bash — a plain `cmd.exe` fails at `pnpm install`, before any server script. pnpm's `shell-emulator` is not a substitute: its shell cannot parse `!`, which breaks the `prepare` guards.

## 3. Install and sign in to the gh CLI

`josh-app version` and kit's Issue workflow call GitHub through `gh`. Install it with `brew install gh` (macOS), `winget install GitHub.cli` (Windows), or see the [gh installation docs](https://github.com/cli/cli#installation), then sign in once per machine:

```bash
gh auth login
gh auth status
```
