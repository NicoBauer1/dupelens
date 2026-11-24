#!/usr/bin/env node
// Benchmarks pairwise matching and regrouping on synthetic fingerprints.
//
//   node tools/bench.mjs                 # 1,000 / 5,000 / 10,000 photos
//   node tools/bench.mjs 20000           # custom sizes
//
// Two collections are simulated:
//   random      hashes of unrelated photos are independent random bits
//               (about 32 of 64 bits differ)
//   correlated  all photos share a typical layout, so unrelated hashes agree
//               on more bits (about 27 bits differ for the DCT hash, 16 for the
//               average hash) — closer to real photo libraries and harder for
//               the prefilter
// In both, 20 % of the photos belong to near-duplicate clusters of 2–4 copies.

import { findPairs } from '../src/engine/matcher.js';
import { groupPairs } from '../src/engine/grouping.js';
import { prepareFingerprint } from '../src/engine/similarity.js';
import { HISTOGRAM_SIZE } from '../src/engine/histogram.js';
import { createRandom } from './lib/synth.mjs';

function makeCollection(count, mode, seed = 1) {
  const random = createRandom(seed);
  // Per-bit probability profiles shared by every photo of the collection.
  const profile = (strength) => Float64Array.from({ length: 64 * 3 }, () => (mode === 'random' ? 0.5 : random() < 0.5 ? 0.5 - strength : 0.5 + strength));
  const pDct = profile(0.2);
  const pDiff = profile(0.25);
  const pAvg = profile(0.35);
  const bitsFrom = (probabilities, offset) => {
    let hi = 0, lo = 0;
    for (let i = 0; i < 32; i++) {
      if (random() < probabilities[offset + i]) hi |= 1 << i;
      if (random() < probabilities[offset + 32 + i]) lo |= 1 << i;
    }
    return [hi >>> 0, lo >>> 0];
  };
  const fresh = () => {
    const hashes = new Uint32Array([...bitsFrom(pDct, 0), ...bitsFrom(pDiff, 64), ...bitsFrom(pAvg, 128)]);
    const histogram = new Float32Array(HISTOGRAM_SIZE);
    let total = 0;
    for (let i = 0; i < HISTOGRAM_SIZE; i++) {
      histogram[i] = random() ** 3;
      total += histogram[i];
    }
    for (let i = 0; i < HISTOGRAM_SIZE; i++) histogram[i] /= total;
    const thumb = new Float32Array(1024);
    const fx = random() * 0.3, fy = random() * 0.3, phase = random() * 6;
    for (let i = 0; i < 1024; i++) thumb[i] = 128 + 100 * Math.sin((i % 32) * fx + Math.floor(i / 32) * fy + phase);
    return { hashes, histogram, thumb, sharpness: 1, analysisWidth: 256, analysisHeight: 192 };
  };
  const variant = (fp) => {
    const hashes = Uint32Array.from(fp.hashes);
    for (let w = 0; w < 6; w++) {
      const flips = Math.floor(random() * 3);
      for (let f = 0; f < flips; f++) hashes[w] = (hashes[w] ^ (1 << Math.floor(random() * 32))) >>> 0;
    }
    const thumb = fp.thumb.map((v) => v + (random() - 0.5) * 8);
    return { ...fp, hashes, thumb, histogram: Float32Array.from(fp.histogram) };
  };
  const items = [];
  while (items.length < count) {
    const base = fresh();
    items.push(base);
    if (random() < 0.08) {
      const copies = 1 + Math.floor(random() * 3);
      for (let c = 0; c < copies && items.length < count; c++) items.push(variant(base));
    }
  }
  return items.map((fp) => ({ sha256: null, fingerprint: prepareFingerprint(fp) }));
}

const sizes = process.argv.slice(2).map(Number).filter(Boolean);
const counts = sizes.length ? sizes : [1000, 5000, 10000];
console.log(`Node ${process.version}, ${process.platform}/${process.arch}\n`);
console.log('| Photos | Collection | Pairs examined | Rejected by hashes | Rejected by colour | SSIM evaluated | Pairs ≥ 50 | Matching | Regroup at 90 |');
console.log('| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
for (const count of counts) {
  for (const mode of ['random', 'correlated']) {
    const items = makeCollection(count, mode, count);
    const t0 = performance.now();
    const { pairs, stats } = findPairs(items);
    const t1 = performance.now();
    const groups = groupPairs(items.length, pairs, 90);
    const t2 = performance.now();
    const pct = (v) => `${((100 * v) / stats.pairsTotal).toFixed(2)} %`;
    console.log(
      `| ${count.toLocaleString('en')} | ${mode} | ${stats.pairsTotal.toLocaleString('en')} | ${pct(stats.hashRejected)} | ${pct(stats.colourRejected)} | ${stats.ssimEvaluated.toLocaleString('en')} | ${pairs.length.toLocaleString('en')} | ${((t1 - t0) / 1000).toFixed(2)} s | ${(t2 - t1).toFixed(1)} ms (${groups.length} groups) |`,
    );
  }
}
