// Raster helpers shared by all fingerprints. Images are plain objects
// { width, height, data } with RGBA bytes in `data`, the same layout that the
// browser's ImageData uses, so the engine runs unchanged in Node and in workers.

/** Luma weights for converting RGB to grey. */
export const LUMA_R = 0.299;
export const LUMA_G = 0.587;
export const LUMA_B = 0.114;

/**
 * Composites RGBA over a white background and returns a new RGB float image
 * (three planes interleaved, values 0..255). Transparent areas of PNGs or
 * WebPs therefore look the way most viewers display them.
 * @param {{ width: number, height: number, data: ArrayLike<number> }} image
 * @returns {Float32Array} length width*height*3
 */
export function rgbaToRgbOverWhite(image) {
  const { width, height, data } = image;
  const n = width * height;
  const out = new Float32Array(n * 3);
  for (let i = 0, p = 0, q = 0; i < n; i++, p += 4, q += 3) {
    const a = data[p + 3] / 255;
    const w = 255 * (1 - a);
    out[q] = data[p] * a + w;
    out[q + 1] = data[p + 1] * a + w;
    out[q + 2] = data[p + 2] * a + w;
  }
  return out;
}

/**
 * Luma plane of an interleaved RGB float image.
 * @param {Float32Array} rgb
 * @param {number} pixelCount
 * @returns {Float32Array}
 */
export function rgbToGray(rgb, pixelCount) {
  const gray = new Float32Array(pixelCount);
  for (let i = 0, q = 0; i < pixelCount; i++, q += 3) {
    gray[i] = LUMA_R * rgb[q] + LUMA_G * rgb[q + 1] + LUMA_B * rgb[q + 2];
  }
  return gray;
}

/**
 * Weights of a one-dimensional area-averaging resampler. Destination sample
 * `d` covers the source interval [d*s/n, (d+1)*s/n); every source sample
 * contributes in proportion to its overlap with that interval. For upscaling
 * the interval is smaller than one source sample and the method degrades to
 * nearest-neighbour sampling, which is fine for the tiny images involved.
 * @param {number} srcSize
 * @param {number} dstSize
 * @returns {{ start: Int32Array, count: Int32Array, weights: Float32Array, stride: number }}
 */
export function areaWeights(srcSize, dstSize) {
  const scale = srcSize / dstSize;
  const stride = Math.ceil(scale) + 2;
  const start = new Int32Array(dstSize);
  const count = new Int32Array(dstSize);
  const weights = new Float32Array(dstSize * stride);
  for (let d = 0; d < dstSize; d++) {
    const a = d * scale;
    const b = Math.min(srcSize, (d + 1) * scale);
    const first = Math.floor(a);
    const last = Math.min(srcSize - 1, Math.ceil(b) - 1);
    let total = 0;
    let k = 0;
    for (let s = first; s <= last; s++, k++) {
      const overlap = Math.min(b, s + 1) - Math.max(a, s);
      weights[d * stride + k] = overlap;
      total += overlap;
    }
    for (let j = 0; j < k; j++) weights[d * stride + j] /= total;
    start[d] = first;
    count[d] = k;
  }
  return { start, count, weights, stride };
}

/**
 * Resizes a multi-channel float image with area averaging (separable).
 * @param {Float32Array} src interleaved samples
 * @param {number} sw source width
 * @param {number} sh source height
 * @param {number} dw destination width
 * @param {number} dh destination height
 * @param {number} [channels=1]
 * @returns {Float32Array}
 */
export function resizeArea(src, sw, sh, dw, dh, channels = 1) {
  const wx = areaWeights(sw, dw);
  const wy = areaWeights(sh, dh);
  // Horizontal pass: sh rows of dw samples.
  const tmp = new Float32Array(dw * sh * channels);
  for (let y = 0; y < sh; y++) {
    const rowIn = y * sw * channels;
    const rowOut = y * dw * channels;
    for (let x = 0; x < dw; x++) {
      const s0 = wx.start[x];
      const n = wx.count[x];
      const wBase = x * wx.stride;
      for (let c = 0; c < channels; c++) {
        let acc = 0;
        for (let k = 0; k < n; k++) acc += src[rowIn + (s0 + k) * channels + c] * wx.weights[wBase + k];
        tmp[rowOut + x * channels + c] = acc;
      }
    }
  }
  // Vertical pass.
  const out = new Float32Array(dw * dh * channels);
  const rowLen = dw * channels;
  for (let y = 0; y < dh; y++) {
    const s0 = wy.start[y];
    const n = wy.count[y];
    const wBase = y * wy.stride;
    const rowOut = y * rowLen;
    for (let k = 0; k < n; k++) {
      const w = wy.weights[wBase + k];
      const rowIn = (s0 + k) * rowLen;
      for (let i = 0; i < rowLen; i++) out[rowOut + i] += tmp[rowIn + i] * w;
    }
  }
  return out;
}

/**
 * Size that fits inside a square of `maxSide` while keeping the aspect ratio.
 * Images that are already small enough keep their size.
 * @param {number} width
 * @param {number} height
 * @param {number} maxSide
 * @returns {{ width: number, height: number }}
 */
export function fitWithin(width, height, maxSide) {
  const long = Math.max(width, height);
  if (long <= maxSide) return { width, height };
  const scale = maxSide / long;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
