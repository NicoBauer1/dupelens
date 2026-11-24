# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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

[Unreleased]: https://github.com/NicoBauer1/dupelens/commits/develop
