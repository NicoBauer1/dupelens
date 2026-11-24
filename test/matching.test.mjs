import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findPairs, findPairsAsync, PairMatcher } from '../src/engine/matcher.js';
import { groupPairs, DisjointSet, indexPairs, pairKey } from '../src/engine/grouping.js';
import { suggestKeeper, compareKeepers, keeperReason } from '../src/engine/keeper.js';
import { compareFingerprints, MIN_SCORE } from '../src/engine/similarity.js';
import { analyse } from '../tools/lib/calibration.mjs';
import * as synth from '../tools/lib/synth.mjs';

const a = synth.renderScene('landscape', 41);
const b = synth.renderScene('city', 42);
const c = synth.renderScene('portrait', 43);
const images = [
  a, // 0
  synth.jpegLike(synth.resize(a, 0.5), 80), // 1 near-duplicate of 0
  b, // 2
  synth.brightness(b, 0.06), // 3 near-duplicate of 2
  c, // 4 unrelated
  synth.crop(a, 0.04), // 5 crop of 0
];
const items = images.map((image) => ({ sha256: null, fingerprint: analyse(image) }));

test('DisjointSet merges and finds roots', () => {
  const sets = new DisjointSet(5);
  assert.equal(sets.union(0, 1), true);
  assert.equal(sets.union(1, 0), false);
  sets.union(3, 4);
  assert.equal(sets.find(0), sets.find(1));
  assert.notEqual(sets.find(0), sets.find(3));
  sets.union(1, 4);
  assert.equal(sets.find(0), sets.find(3));
  assert.equal(sets.size[sets.find(0)], 4);
});

test('the matcher finds the near-duplicates and groups them by threshold', () => {
  const { pairs, stats } = findPairs(items);
  assert.ok(pairs.length >= 3);
  for (let i = 1; i < pairs.length; i++) assert.ok(pairs[i - 1].score >= pairs[i].score, 'sorted by score');
  assert.equal(stats.pairsTotal, 15);
  const groups = groupPairs(items.length, pairs, 90);
  assert.deepEqual(groups, [[0, 1, 5], [2, 3]]);
  const strict = groupPairs(items.length, pairs, 99.9);
  assert.ok(strict.length <= 2);
  assert.deepEqual(groupPairs(items.length, pairs, 100.1), []);
});

test('the pruning bound keeps every pair the exhaustive comparison keeps', () => {
  const pool = [];
  for (const type of synth.SCENE_TYPES) {
    const image = synth.renderScene(type, 7, 96, 72);
    pool.push({ sha256: null, fingerprint: analyse(image) });
    pool.push({ sha256: null, fingerprint: analyse(synth.crop(image, 0.08)) });
  }
  for (const minScore of [50, 70, 90]) {
    const { pairs, stats } = findPairs(pool, { minScore });
    const fast = new Set(pairs.map((p) => pairKey(p.a, p.b)));
    let expected = 0;
    for (let i = 0; i < pool.length; i++) {
      for (let j = i + 1; j < pool.length; j++) {
        if (compareFingerprints(pool[i].fingerprint, pool[j].fingerprint).score >= minScore) {
          expected++;
          assert.ok(fast.has(pairKey(i, j)), `pair ${i}:${j} missing at minScore ${minScore}`);
        }
      }
    }
    assert.equal(pairs.length, expected);
    assert.equal(stats.hashRejected + stats.colourRejected + stats.boundRejected + stats.ssimEvaluated, stats.pairsTotal);
  }
});

test('byte-identical files are paired with score 100 even without a fingerprint', () => {
  const list = [
    { sha256: 'aa', fingerprint: null },
    { sha256: 'bb', fingerprint: items[0].fingerprint },
    { sha256: 'aa', fingerprint: null },
    { sha256: 'aa', fingerprint: null },
    { sha256: 'bb', fingerprint: items[0].fingerprint },
  ];
  const { pairs, stats } = findPairs(list);
  assert.equal(stats.exactPairs, 3);
  assert.ok(pairs.every((p) => p.score === 100 && p.exact === 'bytes'));
  assert.deepEqual(groupPairs(list.length, pairs, 100), [[0, 2, 3], [1, 4]]);
});

test('the async matcher reports progress and returns the same pairs', async () => {
  const seen = [];
  const result = await findPairsAsync(items, { chunk: 2, onProgress: (f) => seen.push(f) });
  assert.deepEqual(result.pairs, findPairs(items).pairs);
  assert.equal(seen.at(-1), 1);
  for (let i = 1; i < seen.length; i++) assert.ok(seen[i] >= seen[i - 1]);
});

test('the matcher handles empty and single-item input', () => {
  assert.deepEqual(findPairs([]).pairs, []);
  assert.deepEqual(findPairs([items[0]]).pairs, []);
  assert.equal(new PairMatcher([]).progress, 1);
  assert.equal(new PairMatcher(items).minScore, MIN_SCORE);
});

test('indexPairs looks pairs up in either order', () => {
  const { pairs } = findPairs(items);
  const index = indexPairs(pairs);
  const first = pairs[0];
  assert.equal(index.get(pairKey(first.b, first.a)), first);
});

test('the keeper suggestion follows the documented order', () => {
  const base = { width: 100, height: 100, size: 1000, sharpness: 10, lastModified: 5000, path: 'b/photo.jpg' };
  assert.equal(suggestKeeper([base, { ...base, width: 200, height: 150 }]), 1);
  assert.equal(suggestKeeper([base, { ...base, size: 2000 }]), 1);
  assert.equal(suggestKeeper([base, { ...base, sharpness: 20 }]), 1);
  assert.equal(suggestKeeper([base, { ...base, lastModified: 4000 }]), 1);
  assert.equal(suggestKeeper([base, { ...base, path: 'a/photo.jpg' }]), 1);
  assert.equal(suggestKeeper([base, { ...base, path: 'photo.jpg' }]), 1, 'shorter path first');
  // Resolution beats file size.
  assert.equal(suggestKeeper([{ ...base, size: 9999 }, { ...base, width: 101 }]), 1);
  assert.equal(compareKeepers(base, { ...base }), 0);
  assert.equal(keeperReason({ ...base, width: 200 }, base), 'higher resolution');
  assert.equal(keeperReason({ ...base, size: 2000 }, base), 'larger file');
  assert.equal(keeperReason({ ...base, sharpness: 20 }, base), 'sharper');
  assert.equal(keeperReason({ ...base, lastModified: 1 }, base), 'older file');
});
