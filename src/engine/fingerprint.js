// Turns decoded pixels into a compact fingerprint. The function is pure and
// DOM-free: the browser hands in ImageData from a canvas, the tests hand in
// synthetic RGBA buffers.

import { rgbaToRgbOverWhite, rgbToGray, resizeArea, fitWithin } from './raster.js';
import { perceptualHashes } from './hashes.js';
import { colourHistogram } from './histogram.js';
import { laplacianVariance } from './sharpness.js';

/**
 * Images are decoded so that their longer side is at most this many pixels
 * before fingerprinting. All fingerprints are defined on this analysis image.
 */
export const ANALYSIS_SIZE = 256;

/** Order of the hashes inside `Fingerprint.hashes` (two words each). */
export const HASH_DCT = 0;
export const HASH_DIFFERENCE = 2;
export const HASH_AVERAGE = 4;

/**
 * @typedef {object} Fingerprint
 * @property {Uint32Array} hashes   [dctHi, dctLo, dHi, dLo, aHi, aLo]
 * @property {Float32Array} histogram normalised soft RGB histogram
 * @property {Float32Array} thumb    32×32 grayscale thumbnail (0..255) for SSIM
 * @property {number} sharpness       variance of the Laplacian
 * @property {number} analysisWidth
 * @property {number} analysisHeight
 */

/**
 * @param {{ width: number, height: number, data: ArrayLike<number> }} image RGBA
 *   pixels, ideally already scaled to {@link ANALYSIS_SIZE}; larger images are
 *   area-averaged down first.
 * @returns {Fingerprint}
 */
export function computeFingerprint(image) {
  let { width, height } = image;
  if (width < 1 || height < 1) throw new RangeError('image has no pixels');
  let rgb = rgbaToRgbOverWhite(image);
  const target = fitWithin(width, height, ANALYSIS_SIZE);
  if (target.width !== width || target.height !== height) {
    rgb = resizeArea(rgb, width, height, target.width, target.height, 3);
    width = target.width;
    height = target.height;
  }
  const pixelCount = width * height;
  const gray = rgbToGray(rgb, pixelCount);
  const { gray32, aHash, dHash, dctHash } = perceptualHashes(gray, width, height);
  const hashes = new Uint32Array([dctHash.hi, dctHash.lo, dHash.hi, dHash.lo, aHash.hi, aHash.lo]);
  return {
    hashes,
    histogram: colourHistogram(rgb, pixelCount),
    thumb: gray32,
    sharpness: laplacianVariance(gray, width, height),
    analysisWidth: width,
    analysisHeight: height,
  };
}

/**
 * Typed arrays of a fingerprint, for zero-copy transfer out of a worker.
 * @param {Fingerprint} fp
 * @returns {ArrayBuffer[]}
 */
export function fingerprintTransferables(fp) {
  return [fp.hashes.buffer, fp.histogram.buffer, fp.thumb.buffer];
}
