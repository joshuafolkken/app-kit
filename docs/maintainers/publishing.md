# Publishing to public npm and GitHub Packages

For app-kit maintainers releasing the package; projects that use app-kit can skip this page. It follows kit's [publishing.md](https://github.com/joshuafolkken/kit/blob/main/docs/publishing.md).

## How a release publishes

A version bump merged to `main` makes `auto-tag.yml` push the `v<version>` tag and dispatch `publish.yml`. That workflow runs two independent jobs, both checking out the dispatched tag so they publish the same source revision:

| Job              | Registry                     | Credential                                        |
| ---------------- | ---------------------------- | ------------------------------------------------- |
| `publish-github` | `https://npm.pkg.github.com` | The workflow's `GITHUB_TOKEN` (`packages: write`) |
| `publish-npm`    | `https://registry.npmjs.org` | npm trusted publishing (OIDC, `id-token: write`)  |

Neither job `needs` the other, so a failure in one does not stop the other; each result is on its own job in the run. `package.json` sets no `publishConfig.registry` — each job names its registry on the command line. The npm job packs the tarball and publishes it from outside the project with `--userconfig /dev/null`, so the repository `.npmrc` mapping of the `@joshuafolkken` scope to GitHub Packages cannot redirect it. No long-lived npm token exists.

## One-time public npm setup

npm can only attach a trusted publisher to a package that already exists, so an npm account that owns the `@joshuafolkken` scope publishes the first version by hand. Enable [two-factor authentication](https://docs.npmjs.com/configuring-two-factor-authentication/) on that account first; complete any browser authentication in the browser and never share authentication or recovery codes.

From a checkout of a release tag that already carries this workflow, build and inspect the tarball:

```bash
pnpm install
pnpm pack --out /tmp/app-kit.tgz
tar -tzf /tmp/app-kit.tgz | less
```

Publish from outside the project, with the scope mapped to public npm for this command so a `~/.npmrc` that routes `@joshuafolkken` to GitHub Packages cannot redirect it:

```bash
cd /tmp
npm login --registry=https://registry.npmjs.org
npm whoami --registry=https://registry.npmjs.org
npm publish /tmp/app-kit.tgz --access public --registry=https://registry.npmjs.org '--@joshuafolkken:registry=https://registry.npmjs.org'
```

A version already on public npm cannot be published again, so pick a version that is not there yet; the same version existing on GitHub Packages does not block it.

Then open the package's **Settings → Trusted publishing** page on npmjs.com and add a GitHub Actions publisher with user `joshuafolkken`, repository `app-kit` and workflow filename `publish.yml`, allowing **direct `npm publish`**. From the next release on, `publish-npm` publishes without any token. See the [npm trusted publishing guide](https://docs.npmjs.com/trusted-publishers/).

## After a release

Check public npm with no local scope mapping:

```bash
curl -fsS 'https://registry.npmjs.org/@joshuafolkken%2fapp-kit' | jq '."dist-tags"'
cd /tmp
npm view @joshuafolkken/app-kit version --userconfig /dev/null '--@joshuafolkken:registry=https://registry.npmjs.org'
```

Confirm the same version on GitHub Packages with `gh api /users/joshuafolkken/packages/npm/app-kit/versions --jq '.[0].name'`. A plain `npm view` on a maintainer machine may use the `@joshuafolkken` mapping in `~/.npmrc` and report the GitHub Packages copy instead. Right after a first publish, the version-specific metadata and tarball can appear before the package-wide metadata; keep checking until the normal install resolves.
