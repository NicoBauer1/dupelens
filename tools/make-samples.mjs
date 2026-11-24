#!/usr/bin/env node
// Generates the synthetic demo photo set in examples/ and its README with the
// groups the engine finds. Everything is drawn procedurally from fixed seeds,
// so running the script again produces byte-identical files.
//
//   node tools/make-samples.mjs            # (re)write examples/
//   node tools/make-samples.mjs --check    # fail if examples/ is out of date

import { mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as synth from './lib/synth.mjs';
import { encodePng, decodePng } from './lib/png.mjs';
import { computeFingerprint } from '../src/engine/fingerprint.js';
import { prepareFingerprint } from '../src/engine/similarity.js';
import { sha256Hex } from '../src/engine/sha256.js';
import { findPairs } from '../src/engine/matcher.js';
import { groupPairs } from '../src/engine/grouping.js';

const root = fileURLToPath(new URL('../examples/', import.meta.url));
const W = 256;
const H = 192;

const beach = synth.renderScene('landscape', 4101, W, H);
const skyline = synth.renderScene('city', 4202, W, H);
const portrait = synth.renderScene('portrait', 4303, W, H);
const harbour = synth.renderScene('seascape', 4404, W, H);
const forest = synth.renderScene('forest', 4505, W, H);
const fruit = synth.renderScene('stillLife', 4606, W, H);
const shapes = synth.renderScene('abstract', 4707, W, H);
const stone = synth.renderScene('texture', 4808, W, H);

/** @type {Array<{ file: string, image?: object, copyOf?: string, note: string }>} */
export const SAMPLES = [
  { file: 'holiday/beach-sunset.png', image: beach, note: 'original' },
  { file: 'holiday/beach-sunset-small.png', image: synth.resize(beach, 0.5), note: 'downscaled to 50 %' },
  { file: 'holiday/beach-sunset-brighter.png', image: synth.brightness(beach, 0.06), note: 'brightness +6 %' },
  { file: 'holiday/copies/beach-sunset.png', copyOf: 'holiday/beach-sunset.png', note: 'byte-identical copy' },
  { file: 'holiday/harbour.png', image: harbour, note: 'original' },
  { file: 'holiday/harbour-caption.png', image: synth.watermark(harbour), note: 'caption bar added' },
  { file: 'city/skyline.png', image: skyline, note: 'original' },
  { file: 'city/skyline-cropped.png', image: synth.crop(skyline, 0.04), note: 'centre crop 4 %' },
  { file: 'city/skyline-recompressed.png', image: synth.jpegLike(skyline, 60), note: 'JPEG-like quality 60, saved as PNG' },
  { file: 'people/portrait.png', image: portrait, note: 'original' },
  { file: 'people/portrait-greyscale.png', image: synth.grayscale(portrait), note: 'converted to greyscale' },
  { file: 'nature/forest.png', image: forest, note: 'original' },
  { file: 'nature/forest-noisy.png', image: synth.noise(forest, 5, 3), note: 'Gaussian noise σ = 5' },
  { file: 'nature/forest-rotated.png', image: synth.rotate90(forest), note: 'rotated 90° (not detected)' },
  { file: 'misc/fruit-bowl.png', image: fruit, note: 'unique' },
  { file: 'misc/shapes.png', image: shapes, note: 'unique' },
  { file: 'misc/stone.png', image: stone, note: 'unique' },
];

const NOT_AN_IMAGE = { file: 'misc/notes.txt', text: 'This is not an image. DupeLens lists it under "Skipped files".\n' };

async function buildFiles() {
  /** @type {Map<string, Uint8Array>} */
  const files = new Map();
  for (const sample of SAMPLES) {
    files.set(sample.file, sample.copyOf ? files.get(sample.copyOf) : encodePng(sample.image));
  }
  files.set(NOT_AN_IMAGE.file, new TextEncoder().encode(NOT_AN_IMAGE.text));
  return files;
}

async function describeGroups(files) {
  const names = SAMPLES.map((s) => s.file);
  const items = [];
  for (const name of names) {
    const bytes = files.get(name);
    const fingerprint = prepareFingerprint(computeFingerprint(decodePng(bytes)));
    items.push({ sha256: await sha256Hex(bytes), fingerprint });
  }
  const { pairs } = findPairs(items);
  const lines = [];
  for (const [label, threshold] of [['default threshold 90 %', 90], ['"Similar shots" preset 80 %', 80]]) {
    const groups = groupPairs(items.length, pairs, threshold);
    lines.push(`### Groups at the ${label}`, '');
    if (!groups.length) lines.push('None.', '');
    groups.forEach((group, g) => {
      lines.push(`${g + 1}. ${group.map((i) => `\`${names[i]}\``).join(', ')}`);
      const inGroup = pairs.filter((p) => group.includes(p.a) && group.includes(p.b) && p.score >= threshold);
      for (const p of inGroup) {
        const exact = p.exact === 'bytes' ? ' (byte-identical)' : p.exact === 'pixels' ? ' (identical pixels)' : '';
        lines.push(`   - \`${names[p.a]}\` ↔ \`${names[p.b]}\`: ${p.score.toFixed(1)} %${exact}`);
      }
    });
    lines.push('');
  }
  return lines.join('\n');
}

function readme(groupsText) {
  const rows = SAMPLES.map((s) => `| \`${s.file}\` | ${s.note} |`).join('\n');
  return `# Example photos

Synthetic, procedurally drawn images for trying DupeLens, for the
documentation and for manual testing. They are generated by
\`node tools/make-samples.mjs\` from fixed seeds and contain no real
photographs. Do not edit them by hand; change the script and run it again.

Load this folder in the app (folder picker or drag and drop) to see the
review flow. \`misc/notes.txt\` is not an image and appears under
"Skipped files".

| File | What it is |
| --- | --- |
${rows}
| \`${NOT_AN_IMAGE.file}\` | not an image (skipped) |

## Expected result

Computed with the engine in Node (\`npm run samples\`). The browser decodes
images with its own resampling, so scores in the app may differ by about one
point.

${groupsText}
\`nature/forest-rotated.png\` is not grouped: rotated and mirrored copies are
not detected (see the known limits in docs/similarity.md).
`;
}

async function main() {
  const check = process.argv.includes('--check');
  const files = await buildFiles();
  files.set('README.md', new TextEncoder().encode(readme(await describeGroups(files))));
  if (check) {
    let stale = 0;
    for (const [name, bytes] of files) {
      const existing = await readFile(path.join(root, name)).catch(() => null);
      if (!existing || Buffer.compare(existing, Buffer.from(bytes)) !== 0) {
        console.error(`out of date: examples/${name}`);
        stale++;
      }
    }
    if (stale) process.exit(1);
    console.log(`examples/ is up to date (${files.size} files)`);
    return;
  }
  await rm(root, { recursive: true, force: true });
  let total = 0;
  for (const [name, bytes] of files) {
    const target = path.join(root, name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
    total += bytes.length;
  }
  const count = (await readdir(root, { recursive: true })).length;
  console.log(`wrote ${files.size} files (${count} entries) to examples/, ${(total / 1024).toFixed(0)} KiB`);
}

await main();
