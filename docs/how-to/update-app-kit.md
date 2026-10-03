# Update app-kit

## When to use it

A new app-kit version is out and you want its updated overlay — the managed scripts, workflows and SvelteKit config lines — together with the kit base it bundles.

## Steps

1. Check what is available, then upgrade:

   ```bash
   josh-app version             # installed vs. latest, including the kit the CLI runs
   josh-app version --upgrade   # upgrade the global and project installs
   ```

2. Re-apply kit's base and the overlay:

   ```bash
   josh-app sync
   ```

   `josh-app sync` is idempotent. It overwrites the files app-kit manages (the managed scripts, `dast.yml`, `load.yml`) and never overwrites the seeded files you own (`zap-baseline.conf` only gains missing baseline rules — [dast.md](../dast.md#seeded-files-and-managed-workflows)).

3. Run `pnpm josh gate`.

## Check it worked

- `josh-app version` shows the project and global installs at the latest release, or at the newest one past the 24h release-age window.
- `git diff` shows the managed files updated and nothing you own changed.

## Common failures

- `josh-app version` still reports an older kit after the upgrade: the global CLI runs the kit it bundles — see [cli.md → The effective kit](../cli.md#the-effective-kit).
- The newest version is not picked up: it may still be inside the 24h release-age window — see [Install → Version-age gotcha](../setup/install.md#2-install).
