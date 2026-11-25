// SHA-256 of file contents, used to find byte-identical copies.
//
// The Web Crypto API (`crypto.subtle.digest`) is used whenever it exists. It
// is missing on some origins, so a compact implementation of
// SHA-256 serves as fallback, e.g. when the page is opened over plain HTTP
// from another machine. Its round constants are derived from their definition
// (fractional parts of the square and cube roots of the first primes) instead
// of being typed in; the unit tests compare both paths.

/** @type {{ k: Uint32Array, h: Uint32Array } | null} */
let sha256Constants = null;

function firstPrimes(count) {
  const primes = [];
  for (let n = 2; primes.length < count; n++) {
    if (primes.every((p) => n % p !== 0)) primes.push(n);
  }
  return primes;
}

function fractionBits(x) {
  return Math.floor((x - Math.floor(x)) * 0x100000000) >>> 0;
}

function getSha256Constants() {
  if (!sha256Constants) {
    const primes = firstPrimes(64);
    sha256Constants = {
      k: Uint32Array.from(primes, (p) => fractionBits(Math.cbrt(p))),
      h: Uint32Array.from(primes.slice(0, 8), (p) => fractionBits(Math.sqrt(p))),
    };
  }
  return sha256Constants;
}

function rotr(x, n) {
  return (x >>> n) | (x << (32 - n));
}

/**
 * Pure JavaScript SHA-256.
 * @param {Uint8Array} bytes
 * @returns {Uint8Array} 32-byte digest
 */
export function sha256Fallback(bytes) {
  const { k, h: init } = getSha256Constants();
  const h = Uint32Array.from(init);
  const bitLength = bytes.length * 8;
  const padded = new Uint8Array((((bytes.length + 9 + 63) >> 6) << 6));
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(padded.length - 4, bitLength >>> 0);

  const w = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let t = 0; t < 16; t++) w[t] = view.getUint32(offset + t * 4);
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
      const s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }
    let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
    for (let t = 0; t < 64; t++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + k[t] + w[t]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + hh) >>> 0;
  }
  const digest = new Uint8Array(32);
  const out = new DataView(digest.buffer);
  for (let i = 0; i < 8; i++) out.setUint32(i * 4, h[i]);
  return digest;
}

/**
 * @param {Uint8Array} digest
 * @returns {string}
 */
export function bytesToHex(digest) {
  let hex = '';
  for (let i = 0; i < digest.length; i++) hex += digest[i].toString(16).padStart(2, '0');
  return hex;
}

/**
 * SHA-256 as 64 hex digits, via Web Crypto when available.
 * @param {ArrayBuffer | Uint8Array} data
 * @returns {Promise<string>}
 */
export async function sha256Hex(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  if (subtle && typeof subtle.digest === 'function') {
    try {
      return bytesToHex(new Uint8Array(await subtle.digest('SHA-256', bytes)));
    } catch {
      // fall through to the JavaScript implementation
    }
  }
  return bytesToHex(sha256Fallback(bytes));
}
