# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-11-25

### Added

- **Try with sample photos** on the start screen: DupeLens draws the synthetic
  demo set in the browser (the same pictures as in `examples/`) and analyses
  it, so the app can be tried without choosing own photos.
- README with screenshots, a usage guide for the three steps, a threshold
  guide, keyboard shortcuts, exports, known limitations and a disclaimer.
- `npm run screenshots` (`tools/screenshots.mjs`) takes the README screenshots
  in `docs/images/` from the sample photos in a headless browser and keeps only
  the image data of the PNG files; the smoke test and the screenshot tool share
  `tools/lib/browser.mjs`.

### Changed

- Simpler interface with three numbered steps — 1 Choose photos, 2 Review
  groups, 3 Export — plain-language labels and one-line hints, for example
  "How similar must photos be?" for the similarity threshold.
- A clearer empty state when no group reaches the similarity, with a button for
  the next lower preset.
- The export dialog is split into "Save your decisions" and "Move the photos
  marked Remove".
- The start screen shows a short note: provided "as is", without warranty;
  keep a backup of your photos.
- The synthetic image generator moved from `tools/lib/synth.mjs` to
  `src/samples/synth.js`, next to the demo set in `src/samples/demo-set.js`.
- Accessibility: a logical keyboard order with a visible focus indicator on
  every step; keep, remove and group buttons name the photo or group they act
  on; the compare modes are toggle buttons; regrouping, sorting and the start
  of an analysis are announced to screen readers; the sticky toolbar no longer
  covers the focused element; control borders and all text meet WCAG 2.2 AA
  contrast in the light and the dark theme (checked by a unit test); states
  stay visible in forced-colours mode.

## [0.1.0] - 2026-11-24

### Added

- Browser app (`index.html` + ES modules): load photos with the file picker,
  the folder picker or drag and drop (including folders); local analysis in a
  Web Worker pool sized from `navigator.hardwareConcurrency`, with a
  main-thread fallback; progress with time estimate and cancel.
- Review flow: threshold slider (70–100 %) with the presets Exact,
  Near-identical, Default and Similar shots, instant regrouping, group cards
  with thumbnails and facts, suggested keeper with reason, Keep/Remove per
  photo, "Not duplicates — keep all", undo, live summary, lazy rendering,
  sort orders, skipped files with reasons.
- Compare view with side by side, slider, flicker and pixel difference modes.
- Keyboard shortcuts (J/K, 1–9, A, N, U, C, T, E, ?), light and dark theme,
  accessible labels and focus states, own inline SVG icons.
- Exports: decisions as JSON and CSV (cells that would start a formula are prefixed), move scripts for
  PowerShell and POSIX sh that move files marked "remove" into
  `_dupelens_review/` — dry run by default, without delete commands, skipping
  existing targets, with literal quoting of hostile file names.
- Zero-dependency development server (`npm run serve`) with the app's
  Content-Security-Policy.
- Single-file build (`npm run build`): `dist/dupelens.html` with inlined
  script and style, the worker started from a Blob URL, a
  Content-Security-Policy pinned to SHA-256 hashes, and byte-identical output
  on every machine; works by double-click from `file://`.
- Headless browser smoke test (`npm run smoke`) over the DevTools protocol,
  without dependencies: loads `examples/`, checks groups, presets, keyboard
  shortcuts, compare modes and exports, and runs the downloaded move scripts
  on a temporary copy.
- README, architecture documentation with benchmark numbers, and a pipeline
  diagram.
- Analysis engine without dependencies: SHA-256 (Web Crypto with a built-in
  fallback), average hash, difference hash, DCT hash (own 2D DCT-II),
  soft-binned colour histogram with histogram intersection, SSIM on a 32 × 32
  thumbnail and a sharpness measure (variance of the Laplacian).
- One similarity score from 0 to 100 %, calibrated on a synthetic transform
  suite; the target bands are asserted in the unit tests
  ([docs/similarity.md](https://github.com/NicoBauer1/dupelens/blob/main/docs/similarity.md)).
- Pair matching with an exact pruning bound (no pair above the lowest
  threshold is skipped), union-find grouping and a documented keeper
  suggestion.
- Header parser for JPEG (including EXIF orientation), PNG, GIF, WebP, BMP,
  HEIC/AVIF and video containers, used to decode at the analysis size and to
  explain skipped files.
- Synthetic example photos in `examples/` (`npm run samples`), calibration
  table (`npm run calibrate`) and matching benchmark (`npm run bench`).
- Repository scaffold: licence, development guide, code of conduct, security
  policy, branching and release documentation, a pull request template, CI
  workflow and decision records.

[Unreleased]: https://github.com/NicoBauer1/dupelens/compare/v1.0.0...develop
[1.0.0]: https://github.com/NicoBauer1/dupelens/compare/v0.1.0...v1.0.0
[0.1.0]: https://github.com/NicoBauer1/dupelens/releases/tag/v0.1.0
