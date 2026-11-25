// Minimal PNG encoder and decoder for the synthetic samples and the tests.
// Compression uses Node's built-in zlib.
//
// Encoder: 8-bit RGB or RGBA, non-interlaced, per-row adaptive filtering
// (the filter with the smallest sum of absolute values).
// Decoder: 8-bit greyscale, greyscale+alpha, RGB, RGBA and palette images,
// non-interlaced. That covers everything the project writes itself.

import { deflateSync, inflateSync } from 'node:zlib';

const PNG_SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let crcTable = null;

/**
 * CRC-32 as used by PNG (reflected polynomial 0xEDB88320).
 * @param {Uint8Array} bytes
 * @param {number} [crc]
 * @returns {number}
 */
export function crc32(bytes, crc = 0) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = ~crc >>> 0;
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** Chunks that describe the image itself; everything else is metadata. */
export const IMAGE_CHUNKS = Object.freeze(['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND']);

/**
 * Lists the chunk types of a PNG file in order.
 * @param {Uint8Array} bytes
 * @returns {string[]}
 */
export function pngChunkTypes(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const types = [];
  for (let p = 8; p + 8 <= bytes.length; p += 12 + view.getUint32(p)) {
    types.push(String.fromCharCode(...bytes.subarray(p + 4, p + 8)));
  }
  return types;
}

/**
 * Removes every chunk except IHDR, PLTE, tRNS, IDAT and IEND (text, time,
 * colour profile, physical size and other metadata). The pixels are unchanged.
 * @param {Uint8Array} bytes
 * @returns {Uint8Array}
 */
export function stripPngMetadata(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const parts = [bytes.subarray(0, 8)];
  for (let p = 8; p + 8 <= bytes.length;) {
    const end = p + 12 + view.getUint32(p);
    if (IMAGE_CHUNKS.includes(String.fromCharCode(...bytes.subarray(p + 4, p + 8)))) parts.push(bytes.subarray(p, end));
    p = end;
  }
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/**
 * Encodes RGBA pixels as PNG. Fully opaque images are stored as RGB.
 * @param {{ width: number, height: number, data: ArrayLike<number> }} image
 * @returns {Uint8Array}
 */
export function encodePng(image) {
  const { width, height, data } = image;
  let opaque = true;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] !== 255) {
      opaque = false;
      break;
    }
  }
  const channels = opaque ? 3 : 4;
  const stride = width * channels;
  const raw = new Uint8Array(height * stride);
  for (let i = 0, j = 0; i < width * height; i++) {
    raw[j++] = data[i * 4];
    raw[j++] = data[i * 4 + 1];
    raw[j++] = data[i * 4 + 2];
    if (!opaque) raw[j++] = data[i * 4 + 3];
  }

  const filtered = new Uint8Array(height * (stride + 1));
  const candidate = new Uint8Array(stride);
  const best = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const row = raw.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? raw.subarray((y - 1) * stride, y * stride) : null;
    let bestType = 0;
    let bestCost = Infinity;
    for (let type = 0; type < 5; type++) {
      let cost = 0;
      for (let x = 0; x < stride; x++) {
        const a = x >= channels ? row[x - channels] : 0;
        const b = prev ? prev[x] : 0;
        const c = prev && x >= channels ? prev[x - channels] : 0;
        let predictor = 0;
        if (type === 1) predictor = a;
        else if (type === 2) predictor = b;
        else if (type === 3) predictor = (a + b) >> 1;
        else if (type === 4) predictor = paeth(a, b, c);
        const v = (row[x] - predictor) & 0xff;
        candidate[x] = v;
        cost += v < 128 ? v : 256 - v;
      }
      if (cost < bestCost) {
        bestCost = cost;
        bestType = type;
        best.set(candidate);
      }
    }
    filtered[y * (stride + 1)] = bestType;
    filtered.set(best, y * (stride + 1) + 1);
  }

  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = opaque ? 2 : 6; // colour type: RGB or RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  const idat = deflateSync(filtered, { level: 9 });
  const parts = [PNG_SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', new Uint8Array(idat)), chunk('IEND', new Uint8Array(0))];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/**
 * Decodes an 8-bit, non-interlaced PNG into RGBA pixels.
 * @param {Uint8Array} bytes
 * @returns {{ width: number, height: number, data: Uint8ClampedArray }}
 */
export function decodePng(bytes) {
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) throw new Error('not a PNG file');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let width = 0, height = 0, bitDepth = 0, colourType = 0, interlace = 0;
  let palette = null;
  let transparency = null;
  const idat = [];
  while (offset < bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    const crc = view.getUint32(offset + 8 + length);
    if (crc !== crc32(bytes.subarray(offset + 4, offset + 8 + length))) throw new Error(`bad CRC in ${type} chunk`);
    if (type === 'IHDR') {
      const h = new DataView(data.buffer, data.byteOffset, data.byteLength);
      width = h.getUint32(0);
      height = h.getUint32(4);
      bitDepth = data[8];
      colourType = data[9];
      interlace = data[12];
    } else if (type === 'PLTE') {
      palette = data;
    } else if (type === 'tRNS') {
      transparency = data;
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }
  if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`);
  if (interlace !== 0) throw new Error('interlaced PNGs are not supported');
  const channelsByType = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
  const channels = channelsByType[colourType];
  if (!channels) throw new Error(`unsupported colour type ${colourType}`);

  const compressed = new Uint8Array(idat.reduce((n, d) => n + d.length, 0));
  let o = 0;
  for (const d of idat) {
    compressed.set(d, o);
    o += d.length;
  }
  const filtered = new Uint8Array(inflateSync(compressed));
  const stride = width * channels;
  const raw = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const type = filtered[y * (stride + 1)];
    const src = filtered.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = raw.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? raw.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? row[x - channels] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= channels ? prev[x - channels] : 0;
      let predictor = 0;
      if (type === 1) predictor = a;
      else if (type === 2) predictor = b;
      else if (type === 3) predictor = (a + b) >> 1;
      else if (type === 4) predictor = paeth(a, b, c);
      else if (type !== 0) throw new Error(`unknown filter type ${type}`);
      row[x] = (src[x] + predictor) & 0xff;
    }
  }

  const out = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const s = i * channels;
    const d = i * 4;
    if (colourType === 0) {
      out[d] = out[d + 1] = out[d + 2] = raw[s];
      out[d + 3] = 255;
    } else if (colourType === 4) {
      out[d] = out[d + 1] = out[d + 2] = raw[s];
      out[d + 3] = raw[s + 1];
    } else if (colourType === 2) {
      out[d] = raw[s];
      out[d + 1] = raw[s + 1];
      out[d + 2] = raw[s + 2];
      out[d + 3] = 255;
    } else if (colourType === 6) {
      out[d] = raw[s];
      out[d + 1] = raw[s + 1];
      out[d + 2] = raw[s + 2];
      out[d + 3] = raw[s + 3];
    } else {
      const index = raw[s];
      if (!palette || index * 3 + 2 >= palette.length) throw new Error('palette index out of range');
      out[d] = palette[index * 3];
      out[d + 1] = palette[index * 3 + 1];
      out[d + 2] = palette[index * 3 + 2];
      out[d + 3] = transparency && index < transparency.length ? transparency[index] : 255;
    }
  }
  return { width, height, data: out };
}
