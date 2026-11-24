# ADR 0002: Process photos only in the browser

- Status: Accepted
- Date: 2026-11-24

## Context

Duplicate finders usually run as desktop programs or upload photos to a
service. Desktop programs need to be installed and get full file
system access; services require uploading photos. Modern browsers can
decode images, run code in parallel (Web Workers) and compute SHA-256 (Web
Crypto) — everything needed to analyse a photo collection locally.

## Decision

- DupeLens is a static web page. All analysis runs in the user's browser.
- The page declares a Content-Security-Policy with `connect-src 'none'`, only
  its own scripts and styles, and no remote images, so that the browser blocks
  network connections from the page.
- Images are decoded only through built-in APIs (`createImageBitmap`,
  `OffscreenCanvas`/canvas `getImageData`), honouring EXIF orientation.
- The page only *reads* files. Changes on disk happen outside the browser,
  through generated scripts that the user reviews and runs — dry-run by
  default, moving (not deleting) files into a review folder.
- The release artefact is one self-contained HTML file that also works when
  opened from disk (`file://`). Workers are created from Blob URLs; if a
  browser refuses that, the analysis falls back to the main thread.

## Consequences

- No accounts and no hosting costs.
- Performance depends on the user's device. Work is spread over a worker pool
  sized from `navigator.hardwareConcurrency`.
- Browsers differ in the formats they decode. Unsupported files are listed with
  a reason instead of failing silently.
- Without file system write access, the app does not move files itself; the
  generated scripts do that when the user runs them.
