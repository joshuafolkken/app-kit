# Install the prerequisites

The tools the [Quick start](../../README.md#quick-start) needs: **Node.js 22.19.0 or later** (kit's `engines.node`, which every app-kit project installs), **pnpm**, **a POSIX shell**, the **gh CLI** and **a running Docker daemon**. Then continue with [Install app-kit](./install.md).

## 1. Check what you have

```bash
node --version   # v22.19.0 or later
pnpm --version
gh --version
docker info      # prints the server details only while the daemon is running
```

app-kit never installs or replaces a machine-wide Node.js, pnpm, gh or Docker. To install Node.js and pnpm, follow kit's [Install the prerequisites](https://github.com/joshuafolkken/kit/blob/main/docs/setup/prerequisites.md#2-install-pnpm-and-nodejs).

## 2. Use a POSIX shell

The `package.json` scripts app-kit distributes are written for `sh`: `dev` and `preview` resolve their port with `$(josh port …)`, and the `prepare` chain gates on `[ … ]` and `command -v`. `cmd.exe` has none of that, so on Windows run them from WSL or Git Bash — a plain `cmd.exe` fails at `pnpm install`, before any server script. pnpm's `shell-emulator` is not a substitute: its shell cannot parse `!`, which breaks the `prepare` guards.

## 3. Install and sign in to the gh CLI

`josh-app version` and kit's Issue workflow call GitHub through `gh`. Install it with `brew install gh` (macOS), `winget install GitHub.cli` (Windows), or see the [gh installation docs](https://github.com/cli/cli#installation), then sign in once per machine:

```bash
gh auth login
gh auth status
```

## 4. Start Docker, or turn the pre-push scan off

`josh-app start` pushes the first commit through the pre-push [`josh-app verify`](../verify.md) hook, and that push always runs the [ZAP baseline scan](../dast.md), which runs in a container. Install [Docker Desktop](https://docs.docker.com/get-started/get-docker/) or any Docker engine, start it, and confirm the daemon answers:

```bash
docker info
```

Without it `josh-app start` stops before it creates anything — the scan is never skipped silently. Later pushes need the daemon only when they touch a file the scan covers.

A project that does not use Docker can turn the pre-push scan off instead. Before `josh-app start`, create `josh-app.config.json` in the project root:

```json
{
	"verify": {
		"dast": false
	}
}
```

`josh-app start` then does not ask for Docker, and `josh-app init` keeps the file as it is. What the setting covers: [dast.md → Turn the pre-push scan off](../dast.md#turn-the-pre-push-scan-off).
