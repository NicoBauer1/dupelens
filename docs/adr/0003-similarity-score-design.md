# ADR 0003: One calibrated similarity score in percent

- Status: Accepted
- Date: 2026-11-24

## Context

Users want to answer one question per pair of photos: "are these the same
picture?" Individual fingerprints answer different parts of it and fail in
different ways:

- SHA-256 only finds byte-identical files.
- The difference hash is very sensitive to noise in flat areas (sky, walls).
- The average hash is robust but coarse and confuses images with a similar
  layout.
- The DCT hash is the most robust hash against resizing and re-encoding, but
  like all hashes it ignores colour.
- A colour histogram ignores structure entirely.
- SSIM measures structure precisely but drops quickly when images are shifted
  (crops).

Showing five numbers would push the decision back to the user, and a single
threshold per signal would need five sliders.

## Decision

- Combine all signals into **one score from 0 to 100** (see
  [docs/similarity.md](../similarity.md)): each signal becomes a dissimilarity
  in [0, 1], shaped by an exponent so that small differences are cheap and
  large ones are expensive, and the score is 100 × (1 − weighted sum).
- Choose the weights, the hash saturation point and the exponents on a
  **synthetic transform suite** with documented target bands (identical = 100,
  resized/re-encoded ≥ 97, mild edits ≥ 90, small crops ≥ 85, unrelated
  clearly below the default threshold of 90). The bands are asserted in the
  unit tests, so any change to a fingerprint or weight that breaks the meaning
  of the scale fails the build.
- Keep the score **monotone in every penalty**. This gives an exact pruning
  bound for matching: the hash terms alone bound the score from above, so most
  pairs are rejected after a few Hamming distances without missing any pair
  above the threshold.
- Do not use machine learning. The score is a transparent formula with a
  handful of constants that can be explained in one page.

## Consequences

- One slider and three presets are enough in the UI; the same number appears
  in the review cards and in the exports.
- The constants are tuned on synthetic images. Real photo libraries may need
  a re-calibration; the suite and `tools/calibrate.mjs` make that a repeatable
  step rather than guesswork.
- Rotated and mirrored copies score low, because all fingerprints are computed
  on the image as stored.
- The lowest threshold is 70 %. Below it, unrelated images start to match and
  the pruning bound loses its effect.
