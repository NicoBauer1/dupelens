import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { sha256Fallback, sha256Hex, bytesToHex } from '../src/engine/sha256.js';
import { encodePng, decodePng, crc32, pngChunkTypes, stripPngMetadata } from '../tools/lib/png.mjs';
import { renderScene, createRandom } from '../src/samples/synth.js';

const text = (s) => new TextEncoder().encode(s);

test('SHA-256 fallback matches known example digests', () => {
  assert.equal(bytesToHex(sha256Fallback(text(''))), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(bytesToHex(sha256Fallback(text('abc'))), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(
    bytesToHex(sha256Fallback(text('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))),
    '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
  );
});

test('SHA-256 fallback agrees with Web Crypto for all padding lengths', async () => {
  const random = createRandom(77);
  for (let length = 0; length < 200; length++) {
    const bytes = Uint8Array.from({ length }, () => Math.floor(random() * 256));
    const expected = bytesToHex(new Uint8Array(await webcrypto.subtle.digest('SHA-256', bytes)));
    assert.equal(bytesToHex(sha256Fallback(bytes)), expected, `length ${length}`);
  }
});

test('sha256Hex accepts ArrayBuffer and Uint8Array', async () => {
  const bytes = text('dupelens');
  assert.equal(await sha256Hex(bytes), await sha256Hex(bytes.buffer));
  assert.match(await sha256Hex(bytes), /^[0-9a-f]{64}$/);
});

test('CRC-32 of the usual check string', () => {
  assert.equal(crc32(text('123456789')), 0xcbf43926);
  assert.equal(crc32(text('IEND')), 0xae426082);
});

test('PNG encoder output decodes back to identical pixels (RGB and RGBA)', () => {
  const image = renderScene('abstract', 3, 40, 30);
  const png = encodePng(image);
  assert.deepEqual(Array.from(png.subarray(0, 8)), [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const decoded = decodePng(png);
  assert.equal(decoded.width, 40);
  assert.equal(decoded.height, 30);
  assert.deepEqual(decoded.data, image.data);

  const translucent = { width: 3, height: 2, data: Uint8ClampedArray.from({ length: 24 }, (_, i) => (i * 37) % 256) };
  assert.deepEqual(decodePng(encodePng(translucent)).data, translucent.data);
});

test('PNG decoder rejects corrupted files', () => {
  const png = encodePng(renderScene('texture', 1, 8, 8));
  const broken = Uint8Array.from(png);
  broken[20] ^= 0xff; // inside IHDR
  assert.throws(() => decodePng(broken), /bad CRC/);
  assert.throws(() => decodePng(text('not a png at all')), /not a PNG/);
});

test('PNG metadata chunks are removed and the pixels stay the same', () => {
  const image = renderScene('abstract', 9, 24, 16);
  const png = encodePng(image);
  const iend = png.length - 12;
  const textChunk = new Uint8Array([0, 0, 0, 4, 0x74, 0x45, 0x58, 0x74, 0x61, 0x3d, 0x62, 0x63, 0, 0, 0, 0]);
  const withText = new Uint8Array([...png.subarray(0, iend), ...textChunk, ...png.subarray(iend)]);
  assert.deepEqual(pngChunkTypes(withText), ['IHDR', 'IDAT', 'tEXt', 'IEND']);
  const stripped = stripPngMetadata(withText);
  assert.deepEqual(pngChunkTypes(stripped), ['IHDR', 'IDAT', 'IEND']);
  assert.deepEqual(stripped, png);
});

test('PNG encoding is deterministic', () => {
  const image = renderScene('landscape', 8, 32, 24);
  assert.deepEqual(encodePng(image), encodePng(image));
});
