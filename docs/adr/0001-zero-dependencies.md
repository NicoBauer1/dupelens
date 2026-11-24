# ADR 0001: Zero third-party dependencies

- Status: Accepted
- Date: 2026-11-24

## Context

DupeLens reads people's photo collections. Users should be able to check that
the page does exactly what it says and nothing else. Every third-party package
— including build tools, test runners and linters — adds code that has to be
reviewed and kept up to date, and is a possible supply-chain risk. The project
is also meant to be easy to audit: one HTML file that someone can read.

The problem itself does not need heavy libraries. Image decoding is provided
by the browser; the fingerprints (hashes, DCT, histograms, SSIM) are compact
algorithms with well-known mathematical definitions.

## Decision

- No runtime dependencies, no CDNs, no web fonts, no icon packs.
- No development dependencies either. Tests use Node's built-in `node:test` and
  `node:assert`. The single-file build is a small in-house script that only
  uses Node's standard library.
- Algorithms are implemented from their mathematical description; code from
  other projects is not copied.

## Consequences

- `npm install` is not needed; `package.json` has no `dependencies` or
  `devDependencies`, and a unit test fails if one is added.
- We maintain our own bundler, PNG encoder/decoder (for test fixtures), static
  development server and test helpers. They are kept deliberately small and are
  covered by tests.
- There is no automatic linter or formatter. `.editorconfig` and code review keep
  the style consistent.
- Formats the browser does not decode (for example HEIC in most browsers) are
  not supported.
