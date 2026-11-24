// The synthetic transform suite used to calibrate and test the similarity
// score. Each transform is applied to procedurally drawn originals of every
// scene type; the score between original and transformed copy is collected.
// Unrelated pairs are all pairs of distinct originals.

import * as synth from './synth.mjs';
import { computeFingerprint } from '../../src/engine/fingerprint.js';
import { prepareFingerprint, compareFingerprints } from '../../src/engine/similarity.js';

/**
 * Bands asserted by the unit tests. `min` is the lowest score any pair of the
 * band may get; `max` (for unrelated pairs) the highest.
 */
export const BANDS = {
  identical: { label: 'Identical pixels', min: 100 },
  resized: { label: 'Resized or re-encoded', min: 97 },
  mild: { label: 'Mild brightness, contrast or noise change', min: 90 },
  crop: { label: 'Small crop (up to 5 %)', min: 85 },
  info: { label: 'Measured only, not a target' },
  unrelated: { label: 'Unrelated images', max: 80 },
};

export const TRANSFORMS = [
  { id: 'copy', label: 'Pixel-identical copy', band: 'identical', apply: synth.copy },
  { id: 'resize-75', label: 'Downscaled to 75 %', band: 'resized', apply: (i) => synth.resize(i, 0.75) },
  { id: 'resize-50', label: 'Downscaled to 50 %', band: 'resized', apply: (i) => synth.resize(i, 0.5) },
  { id: 'resize-25', label: 'Downscaled to 25 %', band: 'resized', apply: (i) => synth.resize(i, 0.25) },
  { id: 'upscale-150', label: 'Upscaled to 150 %', band: 'resized', apply: (i) => synth.resize(i, 1.5) },
  { id: 'jpeg-90', label: 'JPEG-like re-encode, quality 90', band: 'resized', apply: (i) => synth.jpegLike(i, 90) },
  { id: 'jpeg-75', label: 'JPEG-like re-encode, quality 75', band: 'resized', apply: (i) => synth.jpegLike(i, 75) },
  { id: 'resize-50-jpeg-75', label: 'Downscaled to 50 % + quality 75', band: 'resized', apply: (i) => synth.jpegLike(synth.resize(i, 0.5), 75) },
  { id: 'jpeg-50', label: 'JPEG-like re-encode, quality 50', band: 'mild', apply: (i) => synth.jpegLike(i, 50) },
  { id: 'brightness+8', label: 'Brightness +8 %', band: 'mild', apply: (i) => synth.brightness(i, 0.08) },
  { id: 'brightness-8', label: 'Brightness −8 %', band: 'mild', apply: (i) => synth.brightness(i, -0.08) },
  { id: 'contrast+10', label: 'Contrast +10 %', band: 'mild', apply: (i) => synth.contrast(i, 1.1) },
  { id: 'contrast-10', label: 'Contrast −10 %', band: 'mild', apply: (i) => synth.contrast(i, 0.9) },
  { id: 'gamma-0.9', label: 'Gamma 0.9', band: 'mild', apply: (i) => synth.gamma(i, 0.9) },
  { id: 'noise-4', label: 'Gaussian noise σ = 4', band: 'mild', apply: (i) => synth.noise(i, 4, 7) },
  { id: 'noise-8', label: 'Gaussian noise σ = 8', band: 'mild', apply: (i) => synth.noise(i, 8, 7) },
  { id: 'crop-2', label: 'Centre crop 2 %', band: 'crop', apply: (i) => synth.crop(i, 0.02) },
  { id: 'crop-5', label: 'Centre crop 5 %', band: 'crop', apply: (i) => synth.crop(i, 0.05) },
  { id: 'crop-5-corner', label: 'Crop 5 % from right and bottom', band: 'crop', apply: (i) => synth.crop(i, 0.05, 'corner') },
  { id: 'blur-1', label: 'Slight blur (box radius 1, two passes)', band: 'info', apply: (i) => synth.blur(i, 1) },
  { id: 'saturation-70', label: 'Saturation 70 %', band: 'info', apply: (i) => synth.saturation(i, 0.7) },
  { id: 'colour-cast', label: 'Warmer white balance', band: 'info', apply: (i) => synth.colourCast(i, 0.08) },
  { id: 'watermark', label: 'Caption bar in a corner', band: 'info', apply: synth.watermark },
  { id: 'crop-10', label: 'Centre crop 10 %', band: 'info', apply: (i) => synth.crop(i, 0.1) },
  { id: 'jpeg-30', label: 'JPEG-like re-encode, quality 30', band: 'info', apply: (i) => synth.jpegLike(i, 30) },
  { id: 'grayscale', label: 'Converted to greyscale', band: 'info', apply: synth.grayscale },
  { id: 'mirror', label: 'Mirrored (not detected)', band: 'info', apply: synth.mirror },
  { id: 'rotate-90', label: 'Rotated 90° (not detected)', band: 'info', apply: synth.rotate90 },
];

/**
 * Fingerprint as the app computes it, already prepared for pair comparison.
 * @param {{ width: number, height: number, data: Uint8ClampedArray }} image
 */
export const analyse = (image) => prepareFingerprint(computeFingerprint(image));

function summarise(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const pick = (q) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];
  return { min: sorted[0], median: pick(0.5), max: sorted[sorted.length - 1], count: sorted.length };
}

/**
 * Runs the suite.
 * @param {{ seedsPerType?: number, width?: number, height?: number, includeInfo?: boolean }} [options]
 *   `includeInfo: false` skips the transforms that are only measured, which
 *   keeps the unit test fast.
 */
export function runCalibration(options = {}) {
  const { seedsPerType = 3, width = 320, height = 240, includeInfo = true } = options;
  const originals = [];
  for (const type of synth.SCENE_TYPES) {
    for (let s = 0; s < seedsPerType; s++) {
      const seed = 1000 + s * 37 + type.length * 101;
      const image = synth.renderScene(type, seed, width, height);
      originals.push({ type, seed, image, fp: analyse(image) });
    }
  }

  const rows = [];
  for (const transform of TRANSFORMS) {
    if (!includeInfo && transform.band === 'info') continue;
    const scores = [];
    const samples = [];
    for (const original of originals) {
      const result = compareFingerprints(original.fp, analyse(transform.apply(original.image)));
      scores.push(result.score);
      samples.push({ type: original.type, seed: original.seed, ...result });
    }
    rows.push({ id: transform.id, label: transform.label, band: transform.band, ...summarise(scores), samples });
  }

  const unrelated = [];
  const unrelatedSamples = [];
  for (let i = 0; i < originals.length; i++) {
    for (let j = i + 1; j < originals.length; j++) {
      const result = compareFingerprints(originals[i].fp, originals[j].fp);
      unrelated.push(result.score);
      unrelatedSamples.push({ a: `${originals[i].type}#${originals[i].seed}`, b: `${originals[j].type}#${originals[j].seed}`, ...result });
    }
  }
  rows.push({ id: 'unrelated', label: 'Unrelated pairs (all pairs of distinct originals)', band: 'unrelated', ...summarise(unrelated), samples: unrelatedSamples });
  return { originals: originals.length, rows };
}
