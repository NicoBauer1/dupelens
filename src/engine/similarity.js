// The similarity score: one number from 0 to 100 that blends all signals.
// See docs/similarity.md for the meaning of the scale and the calibration.
//
// Every signal is turned into a dissimilarity d in [0, 1] (0 = no difference):
//
//   hash signals      d = min(1, bits / HASH_SATURATION_BITS) ^ HASH_EXPONENT
//                     for the DCT, difference and average hash
//   colour            d = (1 − histogram intersection) ^ COLOUR_EXPONENT
//   structure         d = (1 − max(0, SSIM)) ^ STRUCTURE_EXPONENT
//
// and the score is
//
//   score = 100 × (1 − Σ w_i d_i),   Σ w_i = 1
//
// Identical pixels give exactly 100. Byte-identical files are reported as 100
// without looking at the pixels. Because every term is non-negative, the hash
// terms alone give an upper bound for the score, which the matcher uses to
// skip most pairs after three Hamming distances (see matcher.js).

import { hamming64 } from './bits.js';
import { histogramIntersection } from './histogram.js';
import { prepareSsim, ssim } from './ssim.js';
import { HASH_DCT, HASH_DIFFERENCE, HASH_AVERAGE } from './fingerprint.js';

/**
 * Hamming distance at which a hash counts as completely different. Two
 * unrelated images differ in about 32 of 64 bits.
 */
export const HASH_SATURATION_BITS = 30;
/** Exponents > 1 make small differences cheap and large differences expensive. */
export const HASH_EXPONENT = 3;
export const COLOUR_EXPONENT = 1.5;
export const STRUCTURE_EXPONENT = 2;

/** Weights of the five signals (sum 1), chosen on the calibration suite. */
export const SCORE_WEIGHTS = Object.freeze({
  dct: 0.45,
  difference: 0.05,
  average: 0.1,
  colour: 0.2,
  structure: 0.2,
});

/**
 * Lowest score kept by the matcher; the threshold slider stops at it.
 * Below this value unrelated images start to match (the highest score of an
 * unrelated pair in the calibration suite is in the high 70s), so a lower
 * threshold would only produce noise and slow matching down.
 */
export const MIN_SCORE = 70;

/** Precomputed dissimilarity per Hamming distance 0..64. */
const HASH_DISSIMILARITY = Float64Array.from({ length: 65 }, (_, bits) =>
  Math.min(1, bits / HASH_SATURATION_BITS) ** HASH_EXPONENT,
);

/**
 * @param {number} bits Hamming distance 0..64
 * @returns {number} dissimilarity 0..1
 */
export function hashDissimilarity(bits) {
  return HASH_DISSIMILARITY[bits];
}

/**
 * @typedef {import('./fingerprint.js').Fingerprint & { ssimStats: ReturnType<typeof prepareSsim>, sha256?: string }} PreparedFingerprint
 */

/**
 * Adds the per-image SSIM statistics needed for fast pair comparison.
 * @param {import('./fingerprint.js').Fingerprint & { sha256?: string }} fp
 * @returns {PreparedFingerprint}
 */
export function prepareFingerprint(fp) {
  return { ...fp, ssimStats: prepareSsim(fp.thumb) };
}

/**
 * Weighted hash dissimilarity of two fingerprints and the three distances.
 * @param {Uint32Array} a hashes of the first image
 * @param {Uint32Array} b hashes of the second image
 */
export function hashTerms(a, b) {
  const dct = hamming64(a[HASH_DCT], a[HASH_DCT + 1], b[HASH_DCT], b[HASH_DCT + 1]);
  const difference = hamming64(a[HASH_DIFFERENCE], a[HASH_DIFFERENCE + 1], b[HASH_DIFFERENCE], b[HASH_DIFFERENCE + 1]);
  const average = hamming64(a[HASH_AVERAGE], a[HASH_AVERAGE + 1], b[HASH_AVERAGE], b[HASH_AVERAGE + 1]);
  const penalty =
    SCORE_WEIGHTS.dct * HASH_DISSIMILARITY[dct] +
    SCORE_WEIGHTS.difference * HASH_DISSIMILARITY[difference] +
    SCORE_WEIGHTS.average * HASH_DISSIMILARITY[average];
  return { dct, difference, average, penalty };
}

/**
 * Weighted colour dissimilarity.
 * @param {number} intersection histogram intersection 0..1
 */
export function colourPenalty(intersection) {
  return SCORE_WEIGHTS.colour * Math.max(0, 1 - intersection) ** COLOUR_EXPONENT;
}

/**
 * Weighted structural dissimilarity.
 * @param {number} value SSIM −1..1
 */
export function structurePenalty(value) {
  return SCORE_WEIGHTS.structure * (1 - Math.max(0, Math.min(1, value))) ** STRUCTURE_EXPONENT;
}

/**
 * Rounds a score to one decimal, keeping 100 only for exact matches.
 * @param {number} raw
 * @param {boolean} exact
 */
function roundScore(raw, exact) {
  if (exact) return 100;
  const rounded = Math.round(raw * 10) / 10;
  return Math.max(0, Math.min(99.9, rounded));
}

/**
 * Compares two prepared fingerprints.
 * @param {PreparedFingerprint} a
 * @param {PreparedFingerprint} b
 * @returns {{ score: number, exact: 'bytes' | 'pixels' | null, components: { dct: number, difference: number, average: number, colour: number, structure: number } }}
 */
export function compareFingerprints(a, b) {
  const hashes = hashTerms(a.hashes, b.hashes);
  const colour = histogramIntersection(a.histogram, b.histogram);
  const structure = ssim(a.ssimStats, b.ssimStats);
  const components = { dct: hashes.dct, difference: hashes.difference, average: hashes.average, colour, structure };
  if (a.sha256 && b.sha256 && a.sha256 === b.sha256) return { score: 100, exact: 'bytes', components };
  return { ...combineScore(a, b, hashes.penalty, colour, structure), components };
}

/**
 * Final score from the already computed parts (used by the matcher, which has
 * the hash penalty and the colour intersection at hand).
 * @param {PreparedFingerprint} a
 * @param {PreparedFingerprint} b
 * @param {number} hashPenalty weighted hash dissimilarity
 * @param {number} colour histogram intersection
 * @param {number} structure SSIM
 * @returns {{ score: number, exact: 'pixels' | null }}
 */
export function combineScore(a, b, hashPenalty, colour, structure) {
  const penalty = hashPenalty + colourPenalty(colour) + structurePenalty(structure);
  const pixelsEqual = penalty === 0 || (hashPenalty === 0 && colour > 0.999999 && sameThumb(a, b));
  return { score: roundScore(100 * (1 - penalty), pixelsEqual), exact: pixelsEqual ? 'pixels' : null };
}

/**
 * True when the 32×32 thumbnails are equal to within float rounding.
 * @param {PreparedFingerprint} a
 * @param {PreparedFingerprint} b
 */
function sameThumb(a, b) {
  const x = a.thumb;
  const y = b.thumb;
  for (let i = 0; i < x.length; i++) if (Math.abs(x[i] - y[i]) > 1e-3) return false;
  return true;
}
