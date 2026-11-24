// Structural similarity (SSIM) on a small grayscale image: it compares mean
// brightness, contrast and the correlation of two images window by window:
//
//   SSIM(a, b) = ((2 μa μb + C1)(2 σab + C2)) / ((μa² + μb² + C1)(σa² + σb² + C2))
//
// computed on uniform SSIM_WINDOW×SSIM_WINDOW windows that move by SSIM_STEP
// pixels over the 32×32 thumbnail, and averaged over all windows. Means and
// variances of each image are prepared once; comparing a pair only needs the
// covariances.

export const SSIM_SIZE = 32;
export const SSIM_WINDOW = 8;
export const SSIM_STEP = 4;
const SSIM_C1 = (0.01 * 255) ** 2;
const SSIM_C2 = (0.03 * 255) ** 2;
const SSIM_POSITIONS = Math.floor((SSIM_SIZE - SSIM_WINDOW) / SSIM_STEP) + 1;
export const SSIM_WINDOW_COUNT = SSIM_POSITIONS * SSIM_POSITIONS;

/**
 * Per-window means and variances of a 32×32 grayscale thumbnail.
 * @param {ArrayLike<number>} gray32 1024 samples (0..255)
 * @returns {{ pixels: Float32Array, mean: Float64Array, variance: Float64Array }}
 */
export function prepareSsim(gray32) {
  const pixels = Float32Array.from(gray32);
  const mean = new Float64Array(SSIM_WINDOW_COUNT);
  const variance = new Float64Array(SSIM_WINDOW_COUNT);
  const n = SSIM_WINDOW * SSIM_WINDOW;
  let w = 0;
  for (let wy = 0; wy < SSIM_POSITIONS; wy++) {
    for (let wx = 0; wx < SSIM_POSITIONS; wx++, w++) {
      let sum = 0;
      let sumSq = 0;
      for (let y = 0; y < SSIM_WINDOW; y++) {
        const row = (wy * SSIM_STEP + y) * SSIM_SIZE + wx * SSIM_STEP;
        for (let x = 0; x < SSIM_WINDOW; x++) {
          const v = pixels[row + x];
          sum += v;
          sumSq += v * v;
        }
      }
      const m = sum / n;
      mean[w] = m;
      variance[w] = Math.max(0, sumSq / n - m * m);
    }
  }
  return { pixels, mean, variance };
}

/**
 * Mean SSIM of two prepared thumbnails.
 * @param {{ pixels: Float32Array, mean: Float64Array, variance: Float64Array }} a
 * @param {{ pixels: Float32Array, mean: Float64Array, variance: Float64Array }} b
 * @returns {number} -1..1, 1 for identical thumbnails
 */
export function ssim(a, b) {
  const n = SSIM_WINDOW * SSIM_WINDOW;
  let total = 0;
  let w = 0;
  for (let wy = 0; wy < SSIM_POSITIONS; wy++) {
    for (let wx = 0; wx < SSIM_POSITIONS; wx++, w++) {
      let sumAB = 0;
      for (let y = 0; y < SSIM_WINDOW; y++) {
        const row = (wy * SSIM_STEP + y) * SSIM_SIZE + wx * SSIM_STEP;
        for (let x = 0; x < SSIM_WINDOW; x++) sumAB += a.pixels[row + x] * b.pixels[row + x];
      }
      const ma = a.mean[w];
      const mb = b.mean[w];
      const cov = sumAB / n - ma * mb;
      const num = (2 * ma * mb + SSIM_C1) * (2 * cov + SSIM_C2);
      const den = (ma * ma + mb * mb + SSIM_C1) * (a.variance[w] + b.variance[w] + SSIM_C2);
      total += num / den;
    }
  }
  return total / SSIM_WINDOW_COUNT;
}
