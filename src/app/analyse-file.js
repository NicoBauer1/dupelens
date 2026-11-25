// Reads one file, hashes it, decodes it with the browser's built-in decoders
// and computes its fingerprint. Runs inside a worker (OffscreenCanvas) or, as a
// fallback, on the main thread (a regular canvas element).

import { sha256Hex } from '../engine/sha256.js';
import { readImageInfo, skipReason, decodeFailureReason } from '../engine/imageinfo.js';
import { computeFingerprint, ANALYSIS_SIZE } from '../engine/fingerprint.js';
import { fitWithin } from '../engine/raster.js';

/** Largest intermediate size handed from the browser decoder to the engine. */
const DECODE_LIMIT = ANALYSIS_SIZE * 4;

/**
 * @typedef {object} AnalysisResult
 * @property {'ok' | 'skipped' | 'failed'} status
 * @property {string} sha256
 * @property {string} format
 * @property {number} width  displayed width of the original (0 if unknown)
 * @property {number} height displayed height of the original (0 if unknown)
 * @property {string} [reason] why the file was skipped or could not be decoded
 * @property {boolean} [exactOnly] true if the file still takes part in exact matching
 * @property {import('../engine/fingerprint.js').Fingerprint} [fingerprint]
 */

/**
 * A 2D canvas of the given size: OffscreenCanvas where available, otherwise
 * a detached <canvas> element.
 * @param {number} width
 * @param {number} height
 */
function createCanvas2d(width, height) {
  if (typeof OffscreenCanvas === 'function') {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (context) return { canvas, context };
  }
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return { canvas, context: canvas.getContext('2d', { willReadFrequently: true }) };
  }
  throw new Error('no 2D canvas available');
}

/**
 * True when this realm can decode images to pixels.
 * @returns {boolean}
 */
export function canDecodeHere() {
  if (typeof createImageBitmap !== 'function') return false;
  try {
    const { context } = createCanvas2d(1, 1);
    return Boolean(context && typeof context.getImageData === 'function');
  } catch {
    return false;
  }
}

/**
 * Decodes an image, honouring its EXIF orientation, and returns RGBA pixels
 * whose longer side is at most DECODE_LIMIT.
 * @param {Blob} blob
 * @param {import('../engine/imageinfo.js').ImageInfo} info
 * @returns {Promise<{ pixels: ImageData, width: number, height: number }>} pixels and
 *   the displayed size of the original (from the header, or from a full decode)
 */
async function decodeToPixels(blob, info) {
  let bitmap = null;
  let width = info.displayWidth;
  let height = info.displayHeight;
  if (info.displayWidth > 0 && info.displayHeight > 0) {
    const target = fitWithin(info.displayWidth, info.displayHeight, ANALYSIS_SIZE);
    try {
      // Only the width is given, so the browser keeps the aspect ratio no
      // matter whether it resizes before or after applying the orientation.
      bitmap = await createImageBitmap(blob, { resizeWidth: target.width, resizeQuality: 'high', imageOrientation: 'from-image' });
    } catch {
      bitmap = null;
    }
  }
  if (!bitmap) {
    try {
      bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    } catch {
      bitmap = await createImageBitmap(blob);
    }
    width = bitmap.width;
    height = bitmap.height;
  }
  try {
    const size = fitWithin(bitmap.width, bitmap.height, DECODE_LIMIT);
    const { context } = createCanvas2d(size.width, size.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    return { pixels: context.getImageData(0, 0, size.width, size.height), width, height };
  } finally {
    if (typeof bitmap.close === 'function') bitmap.close();
  }
}

/**
 * @param {File | Blob} file
 * @param {string} [name] file name for format detection
 * @returns {Promise<AnalysisResult>}
 */
export async function analyseFile(file, name = /** @type {File} */ (file).name || '') {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const sha256 = await sha256Hex(bytes);
  const info = readImageInfo(bytes.subarray(0, Math.min(bytes.length, 1 << 20)), name, file.type || '');
  const base = { sha256, format: info.format, width: info.displayWidth, height: info.displayHeight };

  const skip = skipReason(info);
  if (skip) return { ...base, status: 'skipped', reason: skip.reason, exactOnly: skip.exactOnly };

  let decoded;
  try {
    decoded = await decodeToPixels(new Blob([bytes], { type: file.type || '' }), info);
  } catch {
    return { ...base, status: 'failed', reason: decodeFailureReason(info), exactOnly: true };
  }
  const fingerprint = computeFingerprint(decoded.pixels);
  return { ...base, width: decoded.width, height: decoded.height, status: 'ok', fingerprint };
}
