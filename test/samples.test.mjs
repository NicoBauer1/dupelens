import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { demoSamples, DEMO_FILES, DEMO_WIDTH, DEMO_HEIGHT } from '../src/samples/demo-set.js';
import { computeFingerprint } from '../src/engine/fingerprint.js';
import { prepareFingerprint } from '../src/engine/similarity.js';
import { findPairs } from '../src/engine/matcher.js';
import { groupPairs } from '../src/engine/grouping.js';

const root = new URL('../', import.meta.url);
const samples = demoSamples();

test('the sample photo set lists every file once, with an image or a byte-identical copy', () => {
  assert.equal(samples.length, DEMO_FILES.length);
  assert.equal(new Set(samples.map((s) => s.file)).size, samples.length);
  for (const sample of samples) {
    if (sample.copyOf) {
      assert.ok(samples.findIndex((s) => s.file === sample.copyOf) < samples.indexOf(sample), `${sample.file} copies an earlier file`);
    } else {
      assert.ok(sample.image.width > 0 && sample.image.height > 0);
      assert.equal(sample.image.data.length, sample.image.width * sample.image.height * 4);
    }
  }
  assert.equal(samples[0].image.width, DEMO_WIDTH);
  assert.equal(samples[0].image.height, DEMO_HEIGHT);
});

test('the sample photos are drawn the same way every time', () => {
  const again = demoSamples();
  for (let i = 0; i < samples.length; i++) {
    if (!samples[i].image) continue;
    assert.deepEqual(again[i].image.data, samples[i].image.data, samples[i].file);
  }
});

test('the sample photos form the groups documented in examples/README.md', async () => {
  const images = new Map(samples.filter((s) => s.image).map((s) => [s.file, s.image]));
  const items = samples.map((s) => ({
    sha256: s.copyOf ?? s.file,
    fingerprint: prepareFingerprint(computeFingerprint(images.get(s.copyOf ?? s.file))),
  }));
  const { pairs } = findPairs(items);
  const groups = groupPairs(items.length, pairs, 90).map((g) => g.map((i) => samples[i].file).sort());
  assert.equal(groups.length, 5);
  const readme = await readFile(new URL('examples/README.md', root), 'utf8');
  for (const group of groups) {
    for (const file of group) assert.ok(readme.includes(`\`${file}\``), file);
  }
  assert.ok(groups.some((g) => g.length === 4 && g.includes('holiday/copies/beach-sunset.png')));
  assert.ok(!groups.some((g) => g.includes('nature/forest-rotated.png')), 'rotated copies are not grouped');
});

test('the start screen explains the three steps and shows the "as is" note', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');
  const steps = [...html.matchAll(/<li class="step" data-step="(\d)"[^>]*>.*?<\/span> ([^<]+)<\/li>/g)].map((m) => `${m[1]} ${m[2]}`);
  assert.deepEqual(steps, ['1 Choose photos', '2 Review groups', '3 Export']);
  assert.match(html, /id="sample-button"[^>]*>.*Try with sample photos<\/button>/);
  assert.match(html, /id="disclaimer">DupeLens is provided “as is”, without warranty of any kind \(MIT licence\)\. Use it at your own risk and keep a backup of your photos\.</);
  assert.match(html, /How similar must photos be\?/);
});
