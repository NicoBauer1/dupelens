// 64-bit hashes are stored as two unsigned 32-bit words: `hi` holds bits 0-31
// (bit 0 is the most significant bit of `hi`), `lo` holds bits 32-63.

/**
 * Number of set bits in a 32-bit integer (SWAR population count).
 * @param {number} x
 * @returns {number}
 */
export function popcount32(x) {
  x = x - ((x >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  x = (x + (x >>> 4)) & 0x0f0f0f0f;
  return Math.imul(x, 0x01010101) >>> 24;
}

/**
 * Hamming distance between two 64-bit hashes given as word pairs.
 * @param {number} aHi
 * @param {number} aLo
 * @param {number} bHi
 * @param {number} bLo
 * @returns {number} 0..64
 */
export function hamming64(aHi, aLo, bHi, bLo) {
  return popcount32((aHi ^ bHi) >>> 0) + popcount32((aLo ^ bLo) >>> 0);
}

/**
 * Packs 64 booleans (index 0 = most significant bit) into two 32-bit words.
 * @param {ArrayLike<boolean | number>} bits exactly 64 entries
 * @returns {{ hi: number, lo: number }}
 */
export function packBits64(bits) {
  if (bits.length !== 64) throw new RangeError('packBits64 needs exactly 64 bits');
  let hi = 0;
  let lo = 0;
  for (let i = 0; i < 32; i++) {
    if (bits[i]) hi |= 1 << (31 - i);
    if (bits[i + 32]) lo |= 1 << (31 - i);
  }
  return { hi: hi >>> 0, lo: lo >>> 0 };
}

/**
 * Formats a 64-bit hash as 16 lower-case hex digits.
 * @param {number} hi
 * @param {number} lo
 * @returns {string}
 */
export function hashToHex(hi, lo) {
  return (hi >>> 0).toString(16).padStart(8, '0') + (lo >>> 0).toString(16).padStart(8, '0');
}

/**
 * Parses 16 hex digits back into a word pair.
 * @param {string} hex
 * @returns {{ hi: number, lo: number }}
 */
export function hexToHash(hex) {
  if (!/^[0-9a-f]{16}$/i.test(hex)) throw new RangeError(`not a 64-bit hex hash: ${hex}`);
  return { hi: parseInt(hex.slice(0, 8), 16) >>> 0, lo: parseInt(hex.slice(8), 16) >>> 0 };
}
