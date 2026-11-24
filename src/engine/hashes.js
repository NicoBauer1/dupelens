// 64-bit perceptual hashes, each computed from a grayscale image.
//
// - Average hash: 8×8 area-averaged image, bit = pixel brighter than the mean.
// - Difference hash: 9×8 area-averaged image, bit = right neighbour brighter
//   than the pixel (horizontal gradient sign).
// - DCT hash: 32×32 area-averaged image, 2D DCT-II, the 8×8 block of the
//   lowest frequencies, bit = coefficient above the median of the 63 AC
//   coefficients. The DC slot (bit 0) carries no information and is always 0.
//
// All three ignore global brightness changes; the DCT hash also ignores global
// contrast changes, because scaling all AC coefficients keeps their order.

import { packBits64 } from './bits.js';
import { resizeArea } from './raster.js';
import { dct2d } from './dct.js';

/**
 * @param {Float32Array} gray8x8 64 samples
 * @returns {{ hi: number, lo: number }}
 */
export function averageHash(gray8x8) {
  let mean = 0;
  for (let i = 0; i < 64; i++) mean += gray8x8[i];
  mean /= 64;
  const bits = new Uint8Array(64);
  for (let i = 0; i < 64; i++) bits[i] = gray8x8[i] > mean ? 1 : 0;
  return packBits64(bits);
}

/**
 * @param {Float32Array} gray9x8 72 samples, 9 columns × 8 rows
 * @returns {{ hi: number, lo: number }}
 */
export function differenceHash(gray9x8) {
  const bits = new Uint8Array(64);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      bits[y * 8 + x] = gray9x8[y * 9 + x + 1] > gray9x8[y * 9 + x] ? 1 : 0;
    }
  }
  return packBits64(bits);
}

/**
 * @param {Float32Array} gray32 1024 samples, 32×32
 * @returns {{ hi: number, lo: number }}
 */
export function dctHash(gray32) {
  const coefficients = dct2d(gray32, 32, 8);
  const ac = Array.from(coefficients.subarray(1)).sort((a, b) => a - b);
  const median = ac[31]; // 63 values: the 32nd smallest is the median
  const bits = new Uint8Array(64);
  for (let i = 1; i < 64; i++) bits[i] = coefficients[i] > median ? 1 : 0;
  return packBits64(bits);
}

/**
 * The 8×8 average of a 32×32 image, by exact 4×4 block means (identical to an
 * area resize from 32 to 8).
 * @param {Float32Array} gray32
 * @returns {Float32Array}
 */
export function blockMean8(gray32) {
  const out = new Float32Array(64);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) out[(y >> 2) * 8 + (x >> 2)] += gray32[y * 32 + x];
  }
  for (let i = 0; i < 64; i++) out[i] /= 16;
  return out;
}

/**
 * Computes all three hashes from a grayscale image of any size.
 * @param {Float32Array} gray
 * @param {number} width
 * @param {number} height
 * @returns {{ gray32: Float32Array, aHash: {hi:number,lo:number}, dHash: {hi:number,lo:number}, dctHash: {hi:number,lo:number} }}
 */
export function perceptualHashes(gray, width, height) {
  const gray32 = resizeArea(gray, width, height, 32, 32);
  const gray9x8 = resizeArea(gray, width, height, 9, 8);
  return {
    gray32,
    aHash: averageHash(blockMean8(gray32)),
    dHash: differenceHash(gray9x8),
    dctHash: dctHash(gray32),
  };
}
