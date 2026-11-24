// Two-dimensional DCT-II with orthonormal scaling, written from its definition:
//
//   X(u, v) = c(u) c(v) Σ_x Σ_y f(x, y) cos((2x + 1) u π / 2N) cos((2y + 1) v π / 2N)
//   c(0) = √(1/N),  c(k) = √(2/N) for k > 0
//
// The transform is separable, so it is computed as N one-dimensional DCTs over
// the rows followed by one-dimensional DCTs over the columns. Only the lowest
// `keep` frequencies in each direction are produced, because the hashes do not
// look at more.

/** @type {Map<string, Float64Array>} */
const dctBasisCache = new Map();

/**
 * Basis matrix B[k][n] = c(k) cos((2n + 1) k π / 2N) for k < keep, n < N.
 * @param {number} size N
 * @param {number} keep number of frequencies
 * @returns {Float64Array} keep*N entries, row-major by frequency
 */
export function dctBasis(size, keep) {
  const key = `${size}:${keep}`;
  let basis = dctBasisCache.get(key);
  if (basis) return basis;
  basis = new Float64Array(keep * size);
  for (let k = 0; k < keep; k++) {
    const scale = k === 0 ? Math.sqrt(1 / size) : Math.sqrt(2 / size);
    for (let n = 0; n < size; n++) {
      basis[k * size + n] = scale * Math.cos(((2 * n + 1) * k * Math.PI) / (2 * size));
    }
  }
  dctBasisCache.set(key, basis);
  return basis;
}

/**
 * Lowest `keep`×`keep` coefficients of the 2D DCT-II of a square image.
 * @param {ArrayLike<number>} input size*size samples, row-major (y * size + x)
 * @param {number} size N
 * @param {number} [keep=size]
 * @returns {Float64Array} keep*keep coefficients, index u * keep + v where u is
 *   the vertical and v the horizontal frequency
 */
export function dct2d(input, size, keep = size) {
  if (input.length !== size * size) throw new RangeError('dct2d expects a square image');
  const basis = dctBasis(size, keep);
  // Row transforms: rows[y][v] = Σ_x f(x, y) B[v][x]
  const rows = new Float64Array(size * keep);
  for (let y = 0; y < size; y++) {
    for (let v = 0; v < keep; v++) {
      let acc = 0;
      const b = v * size;
      const r = y * size;
      for (let x = 0; x < size; x++) acc += input[r + x] * basis[b + x];
      rows[y * keep + v] = acc;
    }
  }
  // Column transforms: out[u][v] = Σ_y rows[y][v] B[u][y]
  const out = new Float64Array(keep * keep);
  for (let u = 0; u < keep; u++) {
    const b = u * size;
    for (let v = 0; v < keep; v++) {
      let acc = 0;
      for (let y = 0; y < size; y++) acc += rows[y * keep + v] * basis[b + y];
      out[u * keep + v] = acc;
    }
  }
  return out;
}

/**
 * Inverse of {@link dct2d} for a full coefficient block (DCT-III with the same
 * orthonormal scaling). Used by the synthetic re-encoding in the test tools.
 * @param {ArrayLike<number>} coefficients size*size values
 * @param {number} size
 * @returns {Float64Array}
 */
export function idct2d(coefficients, size) {
  const basis = dctBasis(size, size);
  const cols = new Float64Array(size * size);
  // cols[y][v] = Σ_u X[u][v] B[u][y]
  for (let y = 0; y < size; y++) {
    for (let v = 0; v < size; v++) {
      let acc = 0;
      for (let u = 0; u < size; u++) acc += coefficients[u * size + v] * basis[u * size + y];
      cols[y * size + v] = acc;
    }
  }
  const out = new Float64Array(size * size);
  // out[y][x] = Σ_v cols[y][v] B[v][x]
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let acc = 0;
      for (let v = 0; v < size; v++) acc += cols[y * size + v] * basis[v * size + x];
      out[y * size + x] = acc;
    }
  }
  return out;
}
