import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readImageInfo, skipReason, decodeFailureReason, fileExtension } from '../src/engine/imageinfo.js';
import { encodePng } from '../tools/lib/png.mjs';
import { renderScene } from '../tools/lib/synth.mjs';

const bytes = (...parts) => {
  const flat = parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p));
  return Uint8Array.from(flat);
};
const u16be = (v) => [(v >> 8) & 0xff, v & 0xff];
const u16le = (v) => [v & 0xff, (v >> 8) & 0xff];
const u32be = (v) => [(v >>> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
const u32le = (v) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff];

/** Minimal JPEG: SOI, APP1 with an Exif orientation tag, SOF0, EOI. */
function jpeg(width, height, orientation, littleEndian = false) {
  const u16 = littleEndian ? u16le : u16be;
  const u32 = littleEndian ? u32le : u32be;
  const tiff = [...(littleEndian ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(8), ...u16(1), ...u16(0x0112), ...u16(3), ...u32(1), ...u16(orientation), 0, 0, ...u32(0)];
  const app1 = [...'Exif\0\0'].map((c) => c.charCodeAt(0)).concat(tiff);
  const sof = [8, ...u16be(height), ...u16be(width), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  return bytes([0xff, 0xd8], [0xff, 0xe1, ...u16be(app1.length + 2), ...app1], [0xff, 0xc0, ...u16be(sof.length + 2), ...sof], [0xff, 0xd9]);
}

test('JPEG: size from the frame header and EXIF orientation (both byte orders)', () => {
  assert.deepEqual(readImageInfo(jpeg(4000, 3000, 1)), { format: 'jpeg', width: 4000, height: 3000, orientation: 1, displayWidth: 4000, displayHeight: 3000 });
  const rotated = readImageInfo(jpeg(4000, 3000, 6, true));
  assert.equal(rotated.orientation, 6);
  assert.equal(rotated.displayWidth, 3000);
  assert.equal(rotated.displayHeight, 4000);
  assert.equal(readImageInfo(jpeg(10, 20, 3)).displayWidth, 10, 'orientation 3 keeps the size');
});

test('JPEG without EXIF and with progressive frame marker', () => {
  const sof2 = [8, ...u16be(480), ...u16be(640), 1, 1, 0x11, 0];
  const info = readImageInfo(bytes([0xff, 0xd8], [0xff, 0xe0, ...u16be(4), 0, 0], [0xff, 0xc2, ...u16be(sof2.length + 2), ...sof2]));
  assert.deepEqual([info.format, info.width, info.height, info.orientation], ['jpeg', 640, 480, 1]);
});

test('PNG, GIF and BMP sizes', () => {
  const png = encodePng(renderScene('abstract', 1, 33, 17));
  assert.deepEqual([readImageInfo(png).format, readImageInfo(png).width, readImageInfo(png).height], ['png', 33, 17]);
  const gif = readImageInfo(bytes('GIF89a', u16le(320), u16le(200), [0, 0, 0]));
  assert.deepEqual([gif.format, gif.width, gif.height], ['gif', 320, 200]);
  const bmp = readImageInfo(bytes('BM', new Array(16).fill(0), u32le(64), u32le(-48 >>> 0)));
  assert.deepEqual([bmp.format, bmp.width, bmp.height], ['bmp', 64, 48]);
});

test('WebP: lossy, lossless and extended headers', () => {
  const riff = (chunk, payload) => bytes('RIFF', u32le(100), 'WEBP', chunk, u32le(payload.length), payload);
  const vp8 = readImageInfo(riff('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, ...u16le(800), ...u16le(600)]));
  assert.deepEqual([vp8.format, vp8.width, vp8.height], ['webp', 800, 600]);
  // VP8L: 14-bit width-1 and height-1 packed after the signature byte 0x2f.
  const w = 1023, h = 767;
  const bits = (w - 1) | ((h - 1) << 14);
  const vp8l = readImageInfo(riff('VP8L', [0x2f, bits & 0xff, (bits >> 8) & 0xff, (bits >> 16) & 0xff, (bits >>> 24) & 0xff]));
  assert.deepEqual([vp8l.width, vp8l.height], [w, h]);
  const vp8x = readImageInfo(riff('VP8X', [0, 0, 0, 0, 1999 & 0xff, 1999 >> 8, 0, 999 & 0xff, 999 >> 8, 0]));
  assert.deepEqual([vp8x.width, vp8x.height], [2000, 1000]);
});

test('ISO base media: HEIC and AVIF with ispe, videos by brand', () => {
  const ftyp = (major, ...compatible) => bytes(u32be(16 + compatible.length * 4), 'ftyp', major, u32be(0), ...compatible);
  const ispe = bytes(u32be(20), 'ispe', u32be(0), u32be(4032), u32be(3024));
  const heic = readImageInfo(Uint8Array.from([...ftyp('heic', 'mif1'), ...ispe]));
  assert.deepEqual([heic.format, heic.width, heic.height], ['heif', 4032, 3024]);
  assert.equal(readImageInfo(Uint8Array.from([...ftyp('mif1', 'avif'), ...ispe])).format, 'avif');
  assert.equal(readImageInfo(ftyp('isom', 'mp41')).format, 'video');
  assert.equal(readImageInfo(ftyp('qt  ')).format, 'video');
});

test('TIFF, SVG, videos by extension and unknown files', () => {
  assert.equal(readImageInfo(bytes([0x49, 0x49, 0x2a, 0x00, 8, 0, 0, 0])).format, 'tiff');
  assert.equal(readImageInfo(bytes('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>')).format, 'svg');
  assert.equal(readImageInfo(bytes('\0\0\0\0garbage'), 'clip.MOV').format, 'video');
  assert.equal(readImageInfo(bytes('hello'), 'clip.bin', 'video/x-foo').format, 'video');
  assert.equal(readImageInfo(bytes('just text'), 'notes.txt').format, 'unknown');
  assert.equal(readImageInfo(new Uint8Array(0)).format, 'unknown');
});

test('skip and failure reasons', () => {
  assert.match(skipReason({ format: 'video' }).reason, /Videos/);
  assert.equal(skipReason({ format: 'video' }).exactOnly, false);
  assert.equal(skipReason({ format: 'jpeg' }), null);
  assert.equal(skipReason({ format: 'heif' }), null, 'HEIC is tried: Safari can decode it');
  assert.match(decodeFailureReason({ format: 'heif' }), /HEIC/);
  assert.match(decodeFailureReason({ format: 'png' }), /could not decode/);
});

test('fileExtension', () => {
  assert.equal(fileExtension('IMG_0001.JPG'), 'jpg');
  assert.equal(fileExtension('.hidden'), '');
  assert.equal(fileExtension('archive.tar.gz'), 'gz');
  assert.equal(fileExtension('noext'), '');
});
