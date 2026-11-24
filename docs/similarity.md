# The similarity score

DupeLens compares every pair of photos and expresses the result as **one
number from 0 to 100 %**. This page explains what the number means, how it is
computed and how it was calibrated. The design decision is recorded in
[ADR 0003](adr/0003-similarity-score-design.md).

## What the numbers mean in practice

| Score | Meaning | Typical cases |
| ---: | --- | --- |
| **100** | Exact copy | Byte-identical files (same SHA-256), or the same pixels saved again losslessly. |
| **97 – 99.9** | Same picture, different file | Resized, re-saved as JPEG at quality 50–90, exported again from a photo app. |
| **95** | Same picture, lightly edited | Brightness ±8 %, contrast ±10 %, gamma, noise, slight blur, warmer white balance. |
| **90** (default) | Same picture, edited or trimmed | The above plus small crops (≤ 5 %), a caption added in a corner. |
| **80** | Probably the same scene | Larger crops (around 10 %), greyscale versions, strong colour edits. |
| **< 70** | Different pictures | Unrelated photos; rotated or mirrored copies (not detected). |

Scores are shown with one decimal. **100 is reserved for exact matches**:
everything else is capped at 99.9, so "100 %" in the app always means "byte- or
pixel-identical".

### Threshold and presets

The threshold slider goes from **70 to 100 %**. Two photos end up in the same
group when they are connected by pairs that score at least the threshold
(groups are transitive: if A matches B and B matches C, all three form one
group, even if A and C score a bit lower). Each card shows every image's score
against the suggested keeper.

| Preset | Threshold | Use it to find |
| --- | ---: | --- |
| Exact | 100 % | only byte- or pixel-identical copies |
| Near-identical | 95 % | resized or re-encoded copies and very light edits |
| *(default)* | 90 % | the above plus edits and small crops |
| Similar shots | 80 % | also crops, greyscale versions and strongly edited copies |

Below 70 %, unrelated images start to match (the highest score of an
unrelated pair in the calibration suite is 77.5), so the slider stops there.

## How the score is computed

Every image is decoded by the browser at most 256 pixels on its longer side
(honouring the EXIF orientation), composited over white if it has
transparency, and turned into a fingerprint:

| Signal | Definition | Robust to | Sensitive to |
| --- | --- | --- | --- |
| SHA-256 | Hash of the file bytes (Web Crypto, or the built-in fallback) | — | any byte change |
| DCT hash | 32 × 32 grey image → 2D DCT-II → 8 × 8 lowest frequencies → bit = coefficient above the median of the 63 AC terms | resizing, compression, brightness, contrast | crops, rotation |
| Difference hash | 9 × 8 grey image → bit = right neighbour brighter | brightness, contrast | noise in flat areas |
| Average hash | 8 × 8 grey image → bit = pixel brighter than the mean | brightness, compression | layout changes |
| Colour histogram | Joint RGB histogram, 4 bins per channel with soft (trilinear) binning, compared by histogram intersection | resizing, crops, structure changes | colour and brightness edits |
| SSIM | Structural similarity on the 32 × 32 grey image, 8 × 8 windows moved by 4 pixels | brightness, contrast, compression | shifts and crops |
| Sharpness | Variance of the Laplacian | — | — (only used to suggest a keeper) |

Each signal becomes a dissimilarity *d* between 0 (no difference) and 1:

```
d_hash      = min(1, bits / 30) ^ 3          (for each of the three hashes)
d_colour    = (1 − intersection) ^ 1.5
d_structure = (1 − max(0, SSIM)) ^ 2
```

Two unrelated images differ in about 32 of the 64 hash bits; the saturation
point of 30 bits makes such a pair count as completely different. The
exponents make small differences cheap (a re-encoded copy that flips three DCT
bits loses 0.05 points) and large differences expensive.

```
score = 100 × (1 − 0.45·d_DCT − 0.05·d_difference − 0.10·d_average − 0.20·d_colour − 0.20·d_structure)
```

The DCT hash carries the largest weight because it is the most robust signal
in the calibration. The difference hash gets a small weight because it flips
bits in flat regions such as skies even when nothing changed visibly.

### Exact pruning

Every term is non-negative, so the hash terms alone are an upper bound of the
score. When three Hamming distances already push a pair below the lowest
threshold (70 %), the pair is skipped without computing the colour or SSIM
terms. The colour term and an upper bound of SSIM computed from per-window
means and variances (Cauchy–Schwarz) are checked next. No pair that would
score 70 % or more is ever skipped; the unit tests compare the pruned search
with the exhaustive one. Benchmarks are in
[architecture.md](architecture.md#performance).

## Calibration

`node tools/calibrate.mjs` draws 24 synthetic originals (3 seeds for each of
8 procedural scene types: landscape, city, portrait, still life, abstract
shapes, seascape, forest, texture; 320 × 240 pixels), applies each transform
below, and scores the transformed copy against its original. "Unrelated" are
all 276 pairs of distinct originals — including pairs of the same scene type,
which share layout and colours and are therefore harder than typical
unrelated photos.

The weights and exponents were chosen by a grid search that maximised the
margin to the target bands. The unit test `test/calibration.test.mjs` asserts
the bands on 16 originals at every test run.

Measured with Node 24 (scores in %):

| Transform | Target | Min | Median | Max |
| --- | ---: | ---: | ---: | ---: |
| Pixel-identical copy | 100 | 100.0 | 100.0 | 100.0 |
| Downscaled to 75 % | ≥ 97 | 99.9 | 99.9 | 99.9 |
| Downscaled to 50 % | ≥ 97 | 99.9 | 99.9 | 99.9 |
| Downscaled to 25 % | ≥ 97 | 99.3 | 99.9 | 99.9 |
| Upscaled to 150 % | ≥ 97 | 99.9 | 99.9 | 99.9 |
| JPEG-like re-encode, quality 90 | ≥ 97 | 99.9 | 99.9 | 99.9 |
| JPEG-like re-encode, quality 75 | ≥ 97 | 99.7 | 99.9 | 99.9 |
| Downscaled to 50 % + quality 75 | ≥ 97 | 99.5 | 99.9 | 99.9 |
| JPEG-like re-encode, quality 50 | ≥ 90 | 99.6 | 99.9 | 99.9 |
| Brightness +8 % | ≥ 90 | 94.2 | 95.5 | 97.6 |
| Brightness −8 % | ≥ 90 | 94.0 | 96.1 | 97.4 |
| Contrast +10 % | ≥ 90 | 98.9 | 99.4 | 99.8 |
| Contrast −10 % | ≥ 90 | 98.6 | 99.2 | 99.7 |
| Gamma 0.9 | ≥ 90 | 98.3 | 98.8 | 99.3 |
| Gaussian noise σ = 4 | ≥ 90 | 98.9 | 99.9 | 99.9 |
| Gaussian noise σ = 8 | ≥ 90 | 98.7 | 99.9 | 99.9 |
| Centre crop 2 % | ≥ 85 | 98.5 | 99.9 | 99.9 |
| Centre crop 5 % | ≥ 85 | 97.5 | 99.5 | 99.9 |
| Crop 5 % from right and bottom | ≥ 85 | 89.7 | 97.1 | 98.6 |
| Slight blur (box radius 1, two passes) | — | 99.5 | 99.9 | 99.9 |
| Saturation 70 % | — | 93.6 | 98.1 | 99.5 |
| Warmer white balance | — | 97.4 | 98.5 | 99.2 |
| Caption bar in a corner | — | 92.2 | 98.8 | 99.7 |
| Centre crop 10 % | — | 91.9 | 96.9 | 99.2 |
| JPEG-like re-encode, quality 30 | — | 99.4 | 99.9 | 99.9 |
| Converted to greyscale | — | 82.7 | 92.2 | 97.4 |
| Mirrored (not detected) | — | 23.7 | 43.1 | 54.4 |
| Rotated 90° (not detected) | — | 20.0 | 28.6 | 55.6 |
| **Unrelated pairs** | ≤ 80 | 1.7 | 18.4 | 77.5 |

"JPEG-like" is a simulation of baseline JPEG written for the test tools:
YCbCr conversion, 4:2:0 chroma subsampling, 8 × 8 DCT and quantisation with
the usual example tables, scaled by quality.
Crop percentages are removed from both the width and the height.

## Known limits

- **Rotation and mirroring** are not detected (all fingerprints describe the
  image as stored).
- **Large crops** (more than about 10–15 %) and **heavy retouching** fall below
  the default threshold. Use the "Similar shots" preset to see them.
- **Burst shots** of the same scene usually score between 70 and 90 depending
  on how much moved; DupeLens does not try to tell them apart from edits.
- **Documents and screenshots** with the same layout (white page, black text)
  can score high even when the text differs. Review such groups carefully.
- **Different browsers** resample images slightly differently while decoding.
  Scores of the same pair may differ by about one point between browsers.
- The calibration uses synthetic images. Real photo libraries are more varied,
  so some pairs can score higher or lower than they look.
