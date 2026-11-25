// "Try with sample photos": draws the synthetic demo set in the browser and
// turns it into File objects, as if the user had chosen a folder. Nothing is
// downloaded; the PNG files are encoded by the browser's canvas.

import { demoSamples } from '../samples/demo-set.js';

/** Folder name the sample photos appear in. */
export const SAMPLE_FOLDER = 'sample-photos';

/** Fixed modification date of the sample files: 1 January 2026, 12:00 local time. */
const SAMPLE_DATE = new Date(2026, 0, 1, 12, 0).getTime();

/**
 * Encodes RGBA pixels as a PNG blob with a canvas.
 * @param {{ width: number, height: number, data: Uint8ClampedArray }} image
 * @returns {Promise<Blob>}
 */
async function encodePng(image) {
  const pixels = new ImageData(new Uint8ClampedArray(image.data), image.width, image.height);
  if (typeof OffscreenCanvas === 'function') {
    const canvas = new OffscreenCanvas(image.width, image.height);
    const context = canvas.getContext('2d');
    if (context && typeof canvas.convertToBlob === 'function') {
      context.putImageData(pixels, 0, 0);
      return canvas.convertToBlob({ type: 'image/png' });
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.getContext('2d').putImageData(pixels, 0, 0);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG encoding failed'))), 'image/png');
  });
}

/**
 * Creates the sample photos.
 * @param {(done: number, total: number) => void} [onProgress]
 * @returns {Promise<import('./loader.js').LoadedFile[]>}
 */
export async function createSampleFiles(onProgress = () => {}) {
  // Let the page paint the progress view before the drawing starts.
  await new Promise((resolve) => setTimeout(resolve, 0));
  const samples = demoSamples();
  /** @type {Map<string, Blob>} */
  const blobs = new Map();
  const files = [];
  for (const sample of samples) {
    const blob = sample.copyOf ? blobs.get(sample.copyOf) : await encodePng(sample.image);
    blobs.set(sample.file, blob);
    const name = sample.file.slice(sample.file.lastIndexOf('/') + 1);
    files.push({
      path: `${SAMPLE_FOLDER}/${sample.file}`,
      file: new File([blob], name, { type: 'image/png', lastModified: SAMPLE_DATE }),
    });
    onProgress(files.length, samples.length);
  }
  return files;
}
