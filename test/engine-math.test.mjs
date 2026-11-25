import { test } from 'node:test';
import assert from 'node:assert/strict';
import { popcount32, hamming64, packBits64, hashToHex, hexToHash } from '../src/engine/bits.js';
import { dct2d, idct2d } from '../src/engine/dct.js';
import { resizeArea, areaWeights, fitWithin, rgbaToRgbOverWhite, rgbToGray } from '../src/engine/raster.js';
import { averageHash, differenceHash, dctHash, blockMean8 } from '../src/engine/hashes.js';
import { colourHistogram, histogramIntersection, HISTOGRAM_SIZE } from '../src/engine/histogram.js';
import { prepareSsim, ssim, ssimReference } from '../src/engine/ssim.js';
import { laplacianVariance } from '../src/engine/sharpness.js';
import { createRandom } from '../tools/lib/synth.mjs';

const close = (actual, expected, tolerance, message) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message ?? ''} expected ${expected} ± ${tolerance}, got ${actual}`);

test('popcount32 counts bits of edge values', () => {
  assert.equal(popcount32(0), 0);
  assert.equal(popcount32(0xffffffff), 32);
  assert.equal(popcount32(0x80000000), 1);
  assert.equal(popcount32(0x55555555), 16);
  const random = createRandom(3);
  for (let i = 0; i < 200; i++) {
    const x = Math.floor(random() * 0x100000000) >>> 0;
    const expected = x.toString(2).split('').filter((c) => c === '1').length;
    assert.equal(popcount32(x), expected);
  }
});

test('hamming64 is a metric on word pairs', () => {
  assert.equal(hamming64(0, 0, 0, 0), 0);
  assert.equal(hamming64(0xffffffff, 0xffffffff, 0, 0), 64);
  assert.equal(hamming64(1, 0, 0, 1), 2);
  assert.equal(hamming64(5, 7, 5, 7), 0);
});

test('packBits64 and hex round-trip', () => {
  const bits = Array.from({ length: 64 }, (_, i) => (i % 3 === 0 ? 1 : 0));
  const { hi, lo } = packBits64(bits);
  assert.equal(hi >>> 31, 1, 'bit 0 is the most significant bit of hi');
  const hex = hashToHex(hi, lo);
  assert.equal(hex.length, 16);
  assert.deepEqual(hexToHash(hex), { hi, lo });
  assert.throws(() => packBits64([1, 0]));
  assert.throws(() => hexToHash('xyz'));
});

test('DCT-II is orthonormal: energy is preserved and the inverse restores the input', () => {
  const random = createRandom(11);
  const input = Float64Array.from({ length: 64 }, () => random() * 255);
  const coefficients = dct2d(input, 8);
  const energy = (a) => a.reduce((s, v) => s + v * v, 0);
  close(energy(coefficients), energy(input), 1e-6 * energy(input), 'Parseval');
  const restored = idct2d(coefficients, 8);
  for (let i = 0; i < 64; i++) close(restored[i], input[i], 1e-9);
});

test('DCT of a constant image has only a DC coefficient', () => {
  const input = new Float64Array(32 * 32).fill(100);
  const coefficients = dct2d(input, 32, 8);
  close(coefficients[0], 100 * 32, 1e-9, 'DC = mean × N');
  for (let i = 1; i < 64; i++) close(coefficients[i], 0, 1e-9);
});

test('DCT of a horizontal cosine puts the energy into one coefficient', () => {
  const N = 32;
  const input = new Float64Array(N * N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) input[y * N + x] = Math.cos(((2 * x + 1) * 3 * Math.PI) / (2 * N));
  }
  const coefficients = dct2d(input, N, 8);
  // u = 0 (no vertical frequency), v = 3
  assert.ok(Math.abs(coefficients[3]) > 10);
  for (let i = 0; i < 64; i++) if (i !== 3) close(coefficients[i], 0, 1e-9);
});

test('area resize preserves the mean and handles exact block averages', () => {
  const src = Float32Array.from({ length: 16 }, (_, i) => i);
  const out = resizeArea(src, 4, 4, 2, 2);
  assert.deepEqual(Array.from(out), [2.5, 4.5, 10.5, 12.5]);
  const random = createRandom(5);
  const big = Float32Array.from({ length: 37 * 23 }, () => random() * 255);
  const small = resizeArea(big, 37, 23, 9, 8);
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  close(mean(small), mean(big), 0.5);
  const w = areaWeights(10, 3);
  for (let d = 0; d < 3; d++) {
    let total = 0;
    for (let k = 0; k < w.count[d]; k++) total += w.weights[d * w.stride + k];
    close(total, 1, 1e-6, 'weights sum to 1');
  }
});

test('fitWithin keeps the aspect ratio and does not enlarge', () => {
  assert.deepEqual(fitWithin(4000, 3000, 256), { width: 256, height: 192 });
  assert.deepEqual(fitWithin(3000, 4000, 256), { width: 192, height: 256 });
  assert.deepEqual(fitWithin(100, 50, 256), { width: 100, height: 50 });
});

test('transparent pixels are composited over white', () => {
  const rgb = rgbaToRgbOverWhite({ width: 2, height: 1, data: Uint8ClampedArray.from([0, 0, 0, 0, 0, 0, 0, 255]) });
  assert.deepEqual(Array.from(rgb), [255, 255, 255, 0, 0, 0]);
  const gray = rgbToGray(Float32Array.from([255, 0, 0, 0, 255, 0]), 2);
  close(gray[0], 0.299 * 255, 1e-3);
  close(gray[1], 0.587 * 255, 1e-3);
});

test('average and difference hashes follow their definitions', () => {
  const gradient = Float32Array.from({ length: 64 }, (_, i) => i % 8);
  const a = averageHash(gradient);
  assert.equal(hashToHex(a.hi, a.lo), '0f0f0f0f0f0f0f0f');
  const rising = Float32Array.from({ length: 72 }, (_, i) => i % 9);
  const d = differenceHash(rising);
  assert.equal(hashToHex(d.hi, d.lo), 'ffffffffffffffff');
  const falling = Float32Array.from({ length: 72 }, (_, i) => 9 - (i % 9));
  const f = differenceHash(falling);
  assert.equal(hashToHex(f.hi, f.lo), '0000000000000000');
});

test('DCT hash ignores brightness and contrast changes and has a zero DC bit', () => {
  const random = createRandom(9);
  const base = Float32Array.from({ length: 1024 }, (_, i) => 100 + 60 * Math.sin(i / 37) + random() * 20);
  const h1 = dctHash(base);
  const h2 = dctHash(base.map((v) => v * 1.2 + 15));
  assert.equal(hamming64(h1.hi, h1.lo, h2.hi, h2.lo), 0);
  assert.equal(h1.hi >>> 31, 0, 'DC slot is always 0');
  let ones = 0;
  for (let i = 0; i < 32; i++) ones += (h1.hi >>> i) & 1;
  for (let i = 0; i < 32; i++) ones += (h1.lo >>> i) & 1;
  assert.equal(ones, 31, 'median threshold: 31 of 63 AC bits are above the median');
});

test('blockMean8 equals an area resize from 32 to 8', () => {
  const random = createRandom(4);
  const g = Float32Array.from({ length: 1024 }, () => random() * 255);
  const a = blockMean8(g);
  const b = resizeArea(g, 32, 32, 8, 8);
  for (let i = 0; i < 64; i++) close(a[i], b[i], 1e-3);
});

test('colour histogram sums to 1 and intersection behaves like a similarity', () => {
  const red = Float32Array.from({ length: 300 }, (_, i) => (i % 3 === 0 ? 250 : 5));
  const blue = Float32Array.from({ length: 300 }, (_, i) => (i % 3 === 2 ? 250 : 5));
  const hr = colourHistogram(red, 100);
  const hb = colourHistogram(blue, 100);
  assert.equal(hr.length, HISTOGRAM_SIZE);
  close(hr.reduce((s, v) => s + v, 0), 1, 1e-6);
  close(histogramIntersection(hr, hr), 1, 1e-6);
  close(histogramIntersection(hr, hb), 0, 1e-6);
  // Soft binning: a small shift keeps most of the overlap.
  const grey = (v) => colourHistogram(new Float32Array(300).fill(v), 100);
  assert.ok(histogramIntersection(grey(120), grey(126)) > 0.8);
});

test('SSIM is 1 for identical images and drops with distortion', () => {
  const random = createRandom(21);
  const a = Float32Array.from({ length: 1024 }, (_, i) => 128 + 80 * Math.sin(i / 13) * Math.cos(i / 97));
  const noisy = a.map((v) => v + (random() - 0.5) * 60);
  const unrelated = Float32Array.from({ length: 1024 }, () => random() * 255);
  const pa = prepareSsim(a);
  close(ssim(pa, pa), 1, 1e-9);
  const sNoisy = ssim(pa, prepareSsim(noisy));
  const sUnrelated = ssim(pa, prepareSsim(unrelated));
  assert.ok(sNoisy < 1 && sNoisy > sUnrelated, `${sNoisy} > ${sUnrelated}`);
  assert.ok(sUnrelated < 0.2);
});

test('block-based SSIM equals the window-by-window definition', () => {
  const random = createRandom(31);
  for (let k = 0; k < 20; k++) {
    const a = Float32Array.from({ length: 1024 }, () => random() * 255);
    const b = a.map((v, i) => (k % 2 ? v * 0.8 + 20 : random() * 255) + (i % 7));
    close(ssim(prepareSsim(a), prepareSsim(b)), ssimReference(a, b), 1e-9);
  }
});

test('the Laplacian variance is higher for sharper images', () => {
  const w = 64;
  const sharp = Float32Array.from({ length: w * w }, (_, i) => ((i % w) >> 2) % 2 ? 200 : 50);
  const soft = Float32Array.from({ length: w * w }, (_, i) => 125 + 75 * Math.sin((i % w) / 6));
  assert.ok(laplacianVariance(sharp, w, w) > laplacianVariance(soft, w, w));
  assert.equal(laplacianVariance(new Float32Array(w * w).fill(9), w, w), 0);
  assert.equal(laplacianVariance(new Float32Array(4), 2, 2), 0);
});
