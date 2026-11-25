import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { pngChunkTypes, IMAGE_CHUNKS } from '../tools/lib/png.mjs';

const root = new URL('../', import.meta.url);
const readme = await readFile(new URL('README.md', root), 'utf8');

test('the README links only to files that exist', async () => {
  const targets = [...readme.matchAll(/\]\(((?!https?:|#)[^)#\s]+)(#[^)]*)?\)/g)].map((m) => m[1]);
  assert.ok(targets.length > 10);
  for (const target of new Set(targets)) {
    await assert.doesNotReject(stat(new URL(target, root)), `README links to ${target}`);
  }
});

test('the README screenshots are small PNG files in docs/images/ without metadata', async () => {
  const images = [...readme.matchAll(/!\[[^\]]+\]\((docs\/images\/[^)]+)\)/g)].map((m) => m[1]);
  assert.ok(images.length >= 2 && images.length <= 3, `${images.length} screenshots`);
  for (const image of images) {
    const bytes = await readFile(new URL(image, root));
    assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], `${image} is a PNG`);
    assert.ok(bytes.length < 300 * 1024, `${image} is below 300 KiB`);
    const extra = pngChunkTypes(bytes).filter((type) => !IMAGE_CHUNKS.includes(type));
    assert.deepEqual(extra, [], `${image} has no metadata chunks`);
  }
});

test('the README has a disclaimer and the sections of a usage guide', () => {
  for (const heading of ['## Features', '## How it works', '## Quick start', '## Using DupeLens', '### Keyboard shortcuts', '## Known limitations', '## Development and testing', '## Project structure', '## Development and security', '## Disclaimer', '## Licence']) {
    assert.ok(readme.includes(`\n${heading}\n`), heading);
  }
  const disclaimer = readme.slice(readme.indexOf('## Disclaimer'), readme.indexOf('## Licence'));
  assert.match(disclaimer, /"as is", without warranty of any kind/);
  assert.match(disclaimer, /they are not a guarantee/);
  assert.match(disclaimer, /at your own risk/);
  assert.match(disclaimer, /backup of your\s+photos/);
});
