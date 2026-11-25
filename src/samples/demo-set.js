// The synthetic demo photo set. It is drawn procedurally from fixed seeds and
// contains no real photographs. The app uses it for "Try with sample photos"
// (the images are drawn in the browser), and tools/make-samples.mjs writes the
// same set to examples/.

import { renderScene, resize, brightness, watermark, crop, jpegLike, grayscale, noise, rotate90 } from './synth.js';

export const DEMO_WIDTH = 256;
export const DEMO_HEIGHT = 192;

/**
 * @typedef {object} DemoSample
 * @property {string} file relative path, forward slashes
 * @property {{ width: number, height: number, data: Uint8ClampedArray }} [image] RGBA pixels
 * @property {string} [copyOf] path of an earlier sample whose file is copied byte for byte
 * @property {string} note what the sample is
 */

/** Paths and notes of the demo set, in the order in which it is drawn. */
export const DEMO_FILES = [
  ['holiday/beach-sunset.png', 'original'],
  ['holiday/beach-sunset-small.png', 'downscaled to 50 %'],
  ['holiday/beach-sunset-brighter.png', 'brightness +6 %'],
  ['holiday/copies/beach-sunset.png', 'byte-identical copy'],
  ['holiday/harbour.png', 'original'],
  ['holiday/harbour-caption.png', 'caption bar added'],
  ['city/skyline.png', 'original'],
  ['city/skyline-cropped.png', 'centre crop 4 %'],
  ['city/skyline-recompressed.png', 'JPEG-like quality 60, saved as PNG'],
  ['people/portrait.png', 'original'],
  ['people/portrait-greyscale.png', 'converted to greyscale'],
  ['nature/forest.png', 'original'],
  ['nature/forest-noisy.png', 'Gaussian noise σ = 5'],
  ['nature/forest-rotated.png', 'rotated 90° (not detected)'],
  ['misc/fruit-bowl.png', 'unique'],
  ['misc/shapes.png', 'unique'],
  ['misc/stone.png', 'unique'],
];

/**
 * Draws the demo set. Takes a fraction of a second; the result is the same on
 * every call and on every machine.
 * @returns {DemoSample[]}
 */
export function demoSamples() {
  const W = DEMO_WIDTH;
  const H = DEMO_HEIGHT;
  const beach = renderScene('landscape', 4101, W, H);
  const skyline = renderScene('city', 4202, W, H);
  const portrait = renderScene('portrait', 4303, W, H);
  const harbour = renderScene('seascape', 4404, W, H);
  const forest = renderScene('forest', 4505, W, H);
  const fruit = renderScene('stillLife', 4606, W, H);
  const shapes = renderScene('abstract', 4707, W, H);
  const stone = renderScene('texture', 4808, W, H);
  const images = {
    'holiday/beach-sunset.png': beach,
    'holiday/beach-sunset-small.png': resize(beach, 0.5),
    'holiday/beach-sunset-brighter.png': brightness(beach, 0.06),
    'holiday/harbour.png': harbour,
    'holiday/harbour-caption.png': watermark(harbour),
    'city/skyline.png': skyline,
    'city/skyline-cropped.png': crop(skyline, 0.04),
    'city/skyline-recompressed.png': jpegLike(skyline, 60),
    'people/portrait.png': portrait,
    'people/portrait-greyscale.png': grayscale(portrait),
    'nature/forest.png': forest,
    'nature/forest-noisy.png': noise(forest, 5, 3),
    'nature/forest-rotated.png': rotate90(forest),
    'misc/fruit-bowl.png': fruit,
    'misc/shapes.png': shapes,
    'misc/stone.png': stone,
  };
  return DEMO_FILES.map(([file, note]) =>
    file === 'holiday/copies/beach-sunset.png' ? { file, copyOf: 'holiday/beach-sunset.png', note } : { file, image: images[file], note },
  );
}
