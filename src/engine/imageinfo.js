// Reads the format, the pixel size and the EXIF orientation from the first
// bytes of a file — without decoding it. The worker uses this to ask the
// browser for a decode that is already scaled to the analysis size, and to
// give a clear reason for files that are not analysed.
//
// Supported headers: JPEG (frame header, and the orientation tag in the Exif
// block), PNG (IHDR), GIF (logical screen descriptor), WebP (RIFF container,
// VP8/VP8L/VP8X headers), BMP (BITMAPINFOHEADER) and the box structure of
// HEIF/AVIF and video files (ftyp brands, ispe property).

/**
 * @typedef {object} ImageInfo
 * @property {'jpeg'|'png'|'gif'|'webp'|'bmp'|'avif'|'heif'|'tiff'|'svg'|'video'|'unknown'} format
 * @property {number} width  stored width in pixels (0 if unknown)
 * @property {number} height stored height in pixels (0 if unknown)
 * @property {number} orientation EXIF orientation 1..8 (1 = as stored)
 * @property {number} displayWidth  width after applying the orientation
 * @property {number} displayHeight height after applying the orientation
 */

const VIDEO_EXTENSIONS = new Set(['mp4', 'm4v', 'mov', 'avi', 'mkv', 'webm', '3gp', '3g2', 'mts', 'm2ts', 'wmv', 'flv', 'mpg', 'mpeg']);
const HEIF_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1', 'mif2']);
const AVIF_BRANDS = new Set(['avif', 'avis']);
const VIDEO_BRANDS = new Set(['isom', 'iso2', 'mp41', 'mp42', 'qt  ', 'M4V ', 'M4A ', 'avc1', '3gp4', '3gp5', '3g2a', 'dash']);

/** Human-readable names for the UI and the exports. */
export const FORMAT_LABELS = Object.freeze({
  jpeg: 'JPEG',
  png: 'PNG',
  gif: 'GIF',
  webp: 'WebP',
  bmp: 'BMP',
  avif: 'AVIF',
  heif: 'HEIC/HEIF',
  tiff: 'TIFF',
  svg: 'SVG',
  video: 'Video',
  unknown: 'Unknown',
});

/**
 * @param {string} name
 * @returns {string} lower-case extension without the dot
 */
export function fileExtension(name) {
  const dot = name.lastIndexOf('.');
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : '';
}

const ascii = (bytes, start, length) => String.fromCharCode(...bytes.subarray(start, start + length));

/**
 * EXIF orientation from a TIFF structure (APP1 payload after "Exif\0\0").
 * @param {DataView} view
 * @param {number} tiff offset of the TIFF header within the view
 * @param {number} end end of the APP1 segment
 * @returns {number} 1..8, 1 when absent or invalid
 */
function exifOrientation(view, tiff, end) {
  if (tiff + 8 > end) return 1;
  const order = view.getUint16(tiff);
  const little = order === 0x4949;
  if (!little && order !== 0x4d4d) return 1;
  if (view.getUint16(tiff + 2, little) !== 42) return 1;
  const ifd = tiff + view.getUint32(tiff + 4, little);
  if (ifd + 2 > end) return 1;
  const entries = view.getUint16(ifd, little);
  for (let i = 0; i < entries; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > end) break;
    if (view.getUint16(entry, little) === 0x0112) {
      const value = view.getUint16(entry + 8, little);
      return value >= 1 && value <= 8 ? value : 1;
    }
  }
  return 1;
}

/**
 * @param {Uint8Array} bytes
 * @returns {{ width: number, height: number, orientation: number }}
 */
function jpegInfo(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  let orientation = 1;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return { width: 0, height: 0, orientation };
    const marker = bytes[offset + 1];
    if (marker === 0xff) {
      offset++; // fill byte
      continue;
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) break; // end of image / start of scan
    const length = view.getUint16(offset + 2);
    const segment = offset + 4;
    const end = Math.min(bytes.length, offset + 2 + length);
    if (marker === 0xe1 && end - segment >= 6 && ascii(bytes, segment, 6) === 'Exif\0\0') {
      orientation = exifOrientation(view, segment + 6, end);
    }
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame && segment + 5 <= bytes.length) {
      return { height: view.getUint16(segment + 1), width: view.getUint16(segment + 3), orientation };
    }
    offset += 2 + length;
  }
  return { width: 0, height: 0, orientation };
}

/**
 * @param {Uint8Array} bytes
 * @returns {{ width: number, height: number }}
 */
function webpInfo(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunk = ascii(bytes, 12, 4);
  if (chunk === 'VP8X' && bytes.length >= 30) {
    const w = bytes[24] | (bytes[25] << 8) | (bytes[26] << 16);
    const h = bytes[27] | (bytes[28] << 8) | (bytes[29] << 16);
    return { width: w + 1, height: h + 1 };
  }
  if (chunk === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) {
    const b1 = bytes[22], b2 = bytes[23], b3 = bytes[24];
    return { width: 1 + (bytes[21] | ((b1 & 0x3f) << 8)), height: 1 + ((b1 >> 6) | (b2 << 2) | ((b3 & 0x0f) << 10)) };
  }
  if (chunk === 'VP8 ' && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
  }
  return { width: 0, height: 0 };
}

/**
 * Width and height from the first `ispe` (image spatial extents) property of
 * a HEIF/AVIF file. A byte search is enough: the property has a fixed layout.
 * @param {Uint8Array} bytes
 */
function ispeInfo(bytes) {
  const limit = Math.min(bytes.length - 16, 1 << 20);
  for (let i = 4; i <= limit; i++) {
    if (bytes[i] === 0x69 && bytes[i + 1] === 0x73 && bytes[i + 2] === 0x70 && bytes[i + 3] === 0x65) {
      const view = new DataView(bytes.buffer, bytes.byteOffset + i + 8, 8);
      return { width: view.getUint32(0), height: view.getUint32(4) };
    }
  }
  return { width: 0, height: 0 };
}

/**
 * Identifies a file from its first bytes, its name and its MIME type.
 * @param {Uint8Array} bytes the file content (at least the first few KiB)
 * @param {string} [name]
 * @param {string} [mimeType]
 * @returns {ImageInfo}
 */
export function readImageInfo(bytes, name = '', mimeType = '') {
  let format = 'unknown';
  let width = 0;
  let height = 0;
  let orientation = 1;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const at = (i, ...values) => values.every((v, k) => bytes[i + k] === v);

  if (bytes.length >= 3 && at(0, 0xff, 0xd8, 0xff)) {
    format = 'jpeg';
    ({ width, height, orientation } = jpegInfo(bytes));
  } else if (bytes.length >= 24 && at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) {
    format = 'png';
    width = view.getUint32(16);
    height = view.getUint32(20);
  } else if (bytes.length >= 10 && (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a')) {
    format = 'gif';
    width = view.getUint16(6, true);
    height = view.getUint16(8, true);
  } else if (bytes.length >= 16 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    format = 'webp';
    ({ width, height } = webpInfo(bytes));
  } else if (bytes.length >= 26 && ascii(bytes, 0, 2) === 'BM') {
    format = 'bmp';
    width = Math.abs(view.getInt32(18, true));
    height = Math.abs(view.getInt32(22, true));
  } else if (bytes.length >= 12 && ascii(bytes, 4, 4) === 'ftyp') {
    const size = Math.min(view.getUint32(0), bytes.length);
    const brands = [ascii(bytes, 8, 4)];
    for (let i = 16; i + 4 <= size; i += 4) brands.push(ascii(bytes, i, 4));
    if (brands.some((b) => AVIF_BRANDS.has(b))) format = 'avif';
    else if (brands.some((b) => HEIF_BRANDS.has(b))) format = 'heif';
    else if (brands.some((b) => VIDEO_BRANDS.has(b))) format = 'video';
    if (format === 'avif' || format === 'heif') ({ width, height } = ispeInfo(bytes));
  } else if (bytes.length >= 4 && (at(0, 0x49, 0x49, 0x2a, 0x00) || at(0, 0x4d, 0x4d, 0x00, 0x2a))) {
    format = 'tiff';
  } else if (/^\s*(<\?xml[^>]*>\s*)?(<!-{2}[\s\S]*?-{2}>\s*)*<svg[\s>]/i.test(ascii(bytes, 0, Math.min(bytes.length, 512)))) {
    format = 'svg';
  }

  if (format === 'unknown') {
    const ext = fileExtension(name);
    if (mimeType.startsWith('video/') || VIDEO_EXTENSIONS.has(ext)) format = 'video';
  }

  const swap = orientation >= 5;
  return { format, width, height, orientation, displayWidth: swap ? height : width, displayHeight: swap ? width : height };
}

/**
 * Why a file is not analysed, or null when the browser should try to decode it.
 * `exactOnly` is true when byte-identical copies can still be found.
 * @param {ImageInfo} info
 * @returns {{ reason: string, exactOnly: boolean } | null}
 */
export function skipReason(info) {
  switch (info.format) {
    case 'video':
      return { reason: 'Videos are not analysed.', exactOnly: false };
    case 'svg':
      return { reason: 'Vector graphics (SVG) are not analysed.', exactOnly: false };
    case 'unknown':
      return { reason: 'Not a recognised image format.', exactOnly: false };
    default:
      return null;
  }
}

/**
 * Explanation for an image the browser failed to decode.
 * @param {ImageInfo} info
 * @returns {string}
 */
export function decodeFailureReason(info) {
  if (info.format === 'heif') return 'This browser does not decode HEIC/HEIF (Safari does). Exact copies are still found.';
  if (info.format === 'tiff') return 'This browser does not decode TIFF (Safari does). Exact copies are still found.';
  if (info.format === 'avif') return 'This browser does not decode AVIF. Exact copies are still found.';
  return 'The browser could not decode this image (damaged or unsupported variant). Exact copies are still found.';
}
