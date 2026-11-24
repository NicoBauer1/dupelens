// Structural similarity (SSIM) on a small grayscale image: it compares mean
// brightness, contrast and the correlation of two images window by window:
//
//   SSIM(a, b) = ((2 μa μb + C1)(2 σab + C2)) / ((μa² + μb² + C1)(σa² + σb² + C2))
//
// computed on uniform 8×8 windows that move by 4 pixels over the 32×32
// thumbnail (7 × 7 = 49 windows), and averaged over all windows.
//
// Because the step is half the window size, every window consists of exactly
// 2 × 2 blocks of 4 × 4 pixels. Sums are therefore computed once per block
// (64 blocks) and each window adds up its four blocks. Means and variances of
// each image are prepared once; comparing a pair only needs the cross terms.

export const SSIM_SIZE = 32;
export const SSIM_WINDOW = 8;
export const SSIM_STEP = 4;
const SSIM_C1 = (0.01 * 255) ** 2;
const SSIM_C2 = (0.03 * 255) ** 2;
const SSIM_BLOCKS = SSIM_SIZE / SSIM_STEP; // 8 blocks per row
const SSIM_POSITIONS = SSIM_BLOCKS - 1; // 7 window positions per row
export const SSIM_WINDOW_COUNT = SSIM_POSITIONS * SSIM_POSITIONS;
const SSIM_WINDOW_PIXELS = SSIM_WINDOW * SSIM_WINDOW;

/**
 * Adds up products of two thumbnails per 4×4 block.
 * @param {Float32Array} a
 * @param {Float32Array} b
 * @param {Float64Array} out SSIM_BLOCKS² entries, overwritten
 */
function blockProducts(a, b, out) {
  out.fill(0);
  for (let y = 0; y < SSIM_SIZE; y++) {
    const rowBlock = (y >> 2) * SSIM_BLOCKS;
    const row = y * SSIM_SIZE;
    for (let x = 0; x < SSIM_SIZE; x += 4) {
      const i = row + x;
      out[rowBlock + (x >> 2)] += a[i] * b[i] + a[i + 1] * b[i + 1] + a[i + 2] * b[i + 2] + a[i + 3] * b[i + 3];
    }
  }
}

/**
 * Sum of the 2×2 blocks that form window `w`.
 * @param {Float64Array} blocks
 * @param {number} wy
 * @param {number} wx
 */
function windowSum(blocks, wy, wx) {
  const k = wy * SSIM_BLOCKS + wx;
  return blocks[k] + blocks[k + 1] + blocks[k + SSIM_BLOCKS] + blocks[k + SSIM_BLOCKS + 1];
}

/** Scratch buffer for pair comparisons (the engine is single-threaded per realm). */
const ssimScratch = new Float64Array(SSIM_BLOCKS * SSIM_BLOCKS);

/**
 * Per-window means and variances of a 32×32 grayscale thumbnail.
 * @param {ArrayLike<number>} gray32 1024 samples (0..255)
 * @returns {{ pixels: Float32Array, mean: Float64Array, variance: Float64Array }}
 */
export function prepareSsim(gray32) {
  // The fingerprint's thumbnail is used as is (no copy) when it already is a Float32Array.
  const pixels = gray32 instanceof Float32Array ? gray32 : Float32Array.from(gray32);
  const ones = new Float32Array(SSIM_SIZE * SSIM_SIZE).fill(1);
  const sums = new Float64Array(SSIM_BLOCKS * SSIM_BLOCKS);
  const squares = new Float64Array(SSIM_BLOCKS * SSIM_BLOCKS);
  blockProducts(pixels, ones, sums);
  blockProducts(pixels, pixels, squares);
  const mean = new Float64Array(SSIM_WINDOW_COUNT);
  const variance = new Float64Array(SSIM_WINDOW_COUNT);
  for (let wy = 0, w = 0; wy < SSIM_POSITIONS; wy++) {
    for (let wx = 0; wx < SSIM_POSITIONS; wx++, w++) {
      const m = windowSum(sums, wy, wx) / SSIM_WINDOW_PIXELS;
      mean[w] = m;
      variance[w] = Math.max(0, windowSum(squares, wy, wx) / SSIM_WINDOW_PIXELS - m * m);
    }
  }
  return { pixels, mean, variance };
}

/**
 * Mean SSIM of two prepared thumbnails.
 * @param {{ pixels: Float32Array, mean: Float64Array, variance: Float64Array }} a
 * @param {{ pixels: Float32Array, mean: Float64Array, variance: Float64Array }} b
 * @returns {number} -1..1, exactly 1 for identical thumbnails
 */
export function ssim(a, b) {
  blockProducts(a.pixels, b.pixels, ssimScratch);
  let total = 0;
  for (let wy = 0, w = 0; wy < SSIM_POSITIONS; wy++) {
    for (let wx = 0; wx < SSIM_POSITIONS; wx++, w++) {
      const ma = a.mean[w];
      const mb = b.mean[w];
      const cov = windowSum(ssimScratch, wy, wx) / SSIM_WINDOW_PIXELS - ma * mb;
      const num = (2 * ma * mb + SSIM_C1) * (2 * cov + SSIM_C2);
      const den = (ma * ma + mb * mb + SSIM_C1) * (a.variance[w] + b.variance[w] + SSIM_C2);
      total += num / den;
    }
  }
  return total / SSIM_WINDOW_COUNT;
}

/**
 * Cheap upper bound of {@link ssim} from the prepared means and variances
 * only. Per window, SSIM = l · cs with the luminance term
 * l = (2 μa μb + C1) / (μa² + μb² + C1) > 0 and, by the Cauchy–Schwarz
 * inequality σab ≤ σa σb, cs ≤ (2 σa σb + C2) / (σa² + σb² + C2). The matcher
 * uses it to skip the full comparison when even this bound is too low.
 * @param {{ mean: Float64Array, variance: Float64Array }} a
 * @param {{ mean: Float64Array, variance: Float64Array }} b
 * @returns {number}
 */
export function ssimUpperBound(a, b) {
  let total = 0;
  for (let w = 0; w < SSIM_WINDOW_COUNT; w++) {
    const ma = a.mean[w];
    const mb = b.mean[w];
    const va = a.variance[w];
    const vb = b.variance[w];
    const l = (2 * ma * mb + SSIM_C1) / (ma * ma + mb * mb + SSIM_C1);
    const c = (2 * Math.sqrt(va * vb) + SSIM_C2) / (va + vb + SSIM_C2);
    total += l * c;
  }
  return total / SSIM_WINDOW_COUNT;
}

/**
 * Reference implementation that walks every window pixel by pixel. Kept for
 * the unit tests, which check that the block-based version gives the same
 * result.
 * @param {ArrayLike<number>} a 32×32 samples
 * @param {ArrayLike<number>} b 32×32 samples
 */
export function ssimReference(a, b) {
  let total = 0;
  for (let wy = 0; wy < SSIM_POSITIONS; wy++) {
    for (let wx = 0; wx < SSIM_POSITIONS; wx++) {
      let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
      for (let y = 0; y < SSIM_WINDOW; y++) {
        for (let x = 0; x < SSIM_WINDOW; x++) {
          const i = (wy * SSIM_STEP + y) * SSIM_SIZE + wx * SSIM_STEP + x;
          sa += a[i];
          sb += b[i];
          saa += a[i] * a[i];
          sbb += b[i] * b[i];
          sab += a[i] * b[i];
        }
      }
      const n = SSIM_WINDOW_PIXELS;
      const ma = sa / n, mb = sb / n;
      const va = saa / n - ma * ma, vb = sbb / n - mb * mb, cov = sab / n - ma * mb;
      total += ((2 * ma * mb + SSIM_C1) * (2 * cov + SSIM_C2)) / ((ma * ma + mb * mb + SSIM_C1) * (va + vb + SSIM_C2));
    }
  }
  return total / SSIM_WINDOW_COUNT;
}
