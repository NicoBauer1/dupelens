// Joint RGB colour histogram with soft (trilinear) binning, compared by
// histogram intersection (the sum of the bin-wise minimums).
//
// Each channel is divided into HISTOGRAM_BINS bins whose centres are evenly
// spaced. A value between two centres contributes to both bins in proportion
// to its distance, so a small colour shift moves mass gradually instead of
// jumping from one bin to the next. The histogram is normalised to sum 1, and
// the intersection Σ min(a_i, b_i) is therefore a similarity in [0, 1].

export const HISTOGRAM_BINS = 4;
export const HISTOGRAM_SIZE = HISTOGRAM_BINS * HISTOGRAM_BINS * HISTOGRAM_BINS;

/**
 * Splits a channel value into two neighbouring bins and their weights.
 * @param {number} value 0..255
 * @param {Int32Array} binOut two entries
 * @param {Float64Array} weightOut two entries
 */
function softBin(value, binOut, weightOut) {
  const position = (value * HISTOGRAM_BINS) / 256 - 0.5;
  let low = Math.floor(position);
  let fraction = position - low;
  if (low < 0) {
    low = 0;
    fraction = 0;
  } else if (low >= HISTOGRAM_BINS - 1) {
    low = HISTOGRAM_BINS - 1;
    fraction = 0;
  }
  binOut[0] = low;
  binOut[1] = Math.min(low + 1, HISTOGRAM_BINS - 1);
  weightOut[0] = 1 - fraction;
  weightOut[1] = fraction;
}

/**
 * @param {Float32Array} rgb interleaved RGB floats (0..255)
 * @param {number} pixelCount
 * @returns {Float32Array} HISTOGRAM_SIZE bins summing to 1
 */
export function colourHistogram(rgb, pixelCount) {
  const hist = new Float64Array(HISTOGRAM_SIZE);
  const rb = new Int32Array(2), gb = new Int32Array(2), bb = new Int32Array(2);
  const rw = new Float64Array(2), gw = new Float64Array(2), bw = new Float64Array(2);
  const b2 = HISTOGRAM_BINS * HISTOGRAM_BINS;
  for (let i = 0, q = 0; i < pixelCount; i++, q += 3) {
    softBin(rgb[q], rb, rw);
    softBin(rgb[q + 1], gb, gw);
    softBin(rgb[q + 2], bb, bw);
    for (let a = 0; a < 2; a++) {
      if (rw[a] === 0) continue;
      for (let b = 0; b < 2; b++) {
        const wrg = rw[a] * gw[b];
        if (wrg === 0) continue;
        for (let c = 0; c < 2; c++) {
          const w = wrg * bw[c];
          if (w !== 0) hist[rb[a] * b2 + gb[b] * HISTOGRAM_BINS + bb[c]] += w;
        }
      }
    }
  }
  const out = new Float32Array(HISTOGRAM_SIZE);
  const total = pixelCount || 1;
  for (let i = 0; i < HISTOGRAM_SIZE; i++) out[i] = hist[i] / total;
  return out;
}

/**
 * Histogram intersection of two normalised histograms.
 * @param {ArrayLike<number>} a
 * @param {ArrayLike<number>} b
 * @returns {number} 0..1
 */
export function histogramIntersection(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] < b[i] ? a[i] : b[i];
  return Math.min(1, sum);
}
