# Releasing

DupeLens follows [Semantic Versioning](https://semver.org/). A release is the
single file `dist/dupelens.html`, published with a GitHub Release.

## Checklist

1. **Prepare on `develop`.**
   - All pull requests for the release are merged.
   - `npm test` and `npm run build` pass locally.
   - Bump `version` in `package.json` if it is not already the target version.
   - In `CHANGELOG.md`, rename `[Unreleased]` to `[X.Y.Z] - YYYY-MM-DD`, add a
     new empty `[Unreleased]` section and update the comparison links.
   - Commit as `chore(release): vX.Y.Z` on a `chore/release-vX.Y.Z` branch and
     merge it into `develop` via pull request.
2. **Release candidate.** Open a pull request `develop → staging` titled
   `release: vX.Y.Z`. Once `npm test`, `npm run build` and `npm run smoke`
   pass locally, merge it and run the smoke test below against a build of
   `staging`.
3. **Release.** Open a pull request `staging → main` titled `release: vX.Y.Z`
   and merge it.
4. **Tag.** On `main`:

   ```sh
   git checkout main && git pull
   git tag -a vX.Y.Z -m "DupeLens vX.Y.Z"
   git push origin vX.Y.Z
   ```

   Then publish the release, either with the `Release` workflow
   (`.github/workflows/release.yml`, with the tag as input), which builds
   `dist/dupelens.html` and creates the GitHub Release with the notes from the
   matching `CHANGELOG.md` section, or locally:

   ```sh
   npm test && npm run build
   node tools/changelog-section.mjs X.Y.Z > release-notes.md
   gh release create vX.Y.Z dist/dupelens.html --verify-tag --title "DupeLens vX.Y.Z" --notes-file release-notes.md
   ```

5. **Back-merge.** Open a pull request `main → develop` if `main` contains
   commits that `develop` does not have (for example after a hotfix).

## Smoke test

Automated part — headless Chrome or Edge with a throw-away profile and only
the synthetic files from `examples/`:

```sh
npm run build
npm run smoke                     # dist/dupelens.html from file://, with workers
npm run smoke -- --no-workers     # the same with the main-thread fallback
npm run serve                     # local development server, in a second terminal
npm run smoke -- --url <address shown by npm run serve>
```

Manual part — run in at least one Chromium-based browser and Firefox; Safari
if available:

- [ ] `dist/dupelens.html` opens by double-click (`file://`) without console
      errors and shows the version in the footer.
- [ ] **Try with sample photos** finds the groups listed in
      `examples/README.md`.
- [ ] Loading the `examples/` folder via the folder picker and via drag and drop
      finds the expected groups.
- [ ] Moving the threshold slider regroups instantly.
- [ ] Compare view (side by side, slider, flicker, difference) works.
- [ ] JSON, CSV, PowerShell and shell exports download; the scripts run in
      dry-run mode on a copy of `examples/` and move files only with the apply
      flag.
- [ ] The browser's network panel shows no requests after the page has loaded.
