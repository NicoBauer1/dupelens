// Pairwise matching with an exact pruning bound.
//
// The score is 100 × (1 − Σ penalties) with non-negative penalties (see
// similarity.js). The three hash penalties are therefore a lower bound of the
// total penalty: if they alone push the score below `minScore`, the pair stays
// below the threshold, and the more expensive colour and SSIM terms are
// not evaluated. The DCT hash is checked first (it alone can exceed the
// budget), then the other two hashes, the colour term (64 bins), an upper
// bound of SSIM from per-window means and variances, and only then the full
// SSIM. Every stage is a true lower bound of the penalty, so no pair that
// scores at least `minScore` is ever skipped.
//
// All pairs scoring ≥ `minScore` are kept, so that the threshold slider can be
// moved anywhere above `minScore` without matching again.

import { SCORE_WEIGHTS, MIN_SCORE, hashDissimilarity, colourPenalty, structurePenalty, combineScore } from './similarity.js';
import { popcount32 } from './bits.js';
import { histogramIntersection } from './histogram.js';
import { ssim, ssimUpperBound } from './ssim.js';

/**
 * @typedef {object} MatchItem
 * @property {string | null} sha256 content hash, or null if the file could not be read
 * @property {import('./similarity.js').PreparedFingerprint | null} fingerprint null if the image could not be decoded
 */

/**
 * @typedef {object} Pair
 * @property {number} a index of the first item (a < b)
 * @property {number} b index of the second item
 * @property {number} score 0..100
 * @property {'bytes' | 'pixels' | null} exact
 */

/** Penalty per Hamming distance for each hash, scaled by its weight. */
const PENALTY_DCT = Float64Array.from({ length: 65 }, (_, d) => SCORE_WEIGHTS.dct * hashDissimilarity(d));
const PENALTY_DIFFERENCE = Float64Array.from({ length: 65 }, (_, d) => SCORE_WEIGHTS.difference * hashDissimilarity(d));
const PENALTY_AVERAGE = Float64Array.from({ length: 65 }, (_, d) => SCORE_WEIGHTS.average * hashDissimilarity(d));

/**
 * Incremental matcher. Call {@link PairMatcher#step} until `done`; this lets
 * the caller keep the page responsive and report progress.
 */
export class PairMatcher {
  /**
   * @param {MatchItem[]} items
   * @param {{ minScore?: number }} [options]
   */
  constructor(items, options = {}) {
    this.items = items;
    this.minScore = options.minScore ?? MIN_SCORE;
    // Scores are rounded to one decimal, so a pair whose exact score is just
    // below minScore (by less than 0.05) still counts; the budget allows for it.
    this.budget = 1 - (this.minScore - 0.05) / 100 + 1e-12;
    /** @type {Pair[]} */
    this.pairs = [];
    this.stats = { pairsTotal: 0, hashRejected: 0, colourRejected: 0, boundRejected: 0, ssimEvaluated: 0, exactPairs: 0 };

    // Byte-identical files: chain every group of equal hashes with score 100.
    const bySha = new Map();
    items.forEach((item, index) => {
      if (!item.sha256) return;
      const list = bySha.get(item.sha256);
      if (list) list.push(index);
      else bySha.set(item.sha256, [index]);
    });
    for (const list of bySha.values()) {
      for (let k = 1; k < list.length; k++) {
        this.pairs.push({ a: list[0], b: list[k], score: 100, exact: 'bytes' });
        this.stats.exactPairs++;
      }
    }

    // Only decodable images take part in perceptual matching.
    this.indices = [];
    items.forEach((item, index) => {
      if (item.fingerprint) this.indices.push(index);
    });
    const n = this.indices.length;
    this.hashWords = new Uint32Array(n * 6);
    this.indices.forEach((index, k) => this.hashWords.set(items[index].fingerprint.hashes, k * 6));
    this.row = 0;
    this.pairsDone = 0;
    this.stats.pairsTotal = (n * (n - 1)) / 2;
    this.done = n < 2;
  }

  /** Fraction of candidate pairs examined so far (0..1). */
  get progress() {
    return this.stats.pairsTotal === 0 ? 1 : this.pairsDone / this.stats.pairsTotal;
  }

  /**
   * Processes rows until about `pairBudget` pairs have been examined.
   * @param {number} [pairBudget=2_000_000]
   * @returns {boolean} true when all pairs have been examined
   */
  step(pairBudget = 2_000_000) {
    const { items, indices, hashWords, budget } = this;
    const n = indices.length;
    let examined = 0;
    while (this.row < n - 1 && examined < pairBudget) {
      const i = this.row++;
      const o = i * 6;
      const d0 = hashWords[o], d1 = hashWords[o + 1], f0 = hashWords[o + 2], f1 = hashWords[o + 3], a0 = hashWords[o + 4], a1 = hashWords[o + 5];
      const itemI = items[indices[i]];
      for (let j = i + 1; j < n; j++) {
        const p = j * 6;
        let x = (d0 ^ hashWords[p]) >>> 0;
        let y = (d1 ^ hashWords[p + 1]) >>> 0;
        let penalty = PENALTY_DCT[popcount32(x) + popcount32(y)];
        if (penalty > budget) {
          this.stats.hashRejected++;
          continue;
        }
        x = (f0 ^ hashWords[p + 2]) >>> 0;
        y = (f1 ^ hashWords[p + 3]) >>> 0;
        penalty += PENALTY_DIFFERENCE[popcount32(x) + popcount32(y)];
        x = (a0 ^ hashWords[p + 4]) >>> 0;
        y = (a1 ^ hashWords[p + 5]) >>> 0;
        penalty += PENALTY_AVERAGE[popcount32(x) + popcount32(y)];
        if (penalty > budget) {
          this.stats.hashRejected++;
          continue;
        }
        const itemJ = items[indices[j]];
        if (itemI.sha256 && itemI.sha256 === itemJ.sha256) continue; // already paired as exact
        const fa = itemI.fingerprint;
        const fb = itemJ.fingerprint;
        const colour = histogramIntersection(fa.histogram, fb.histogram);
        const partial = penalty + colourPenalty(colour);
        if (partial > budget) {
          this.stats.colourRejected++;
          continue;
        }
        if (partial + structurePenalty(ssimUpperBound(fa.ssimStats, fb.ssimStats)) > budget) {
          this.stats.boundRejected++;
          continue;
        }
        this.stats.ssimEvaluated++;
        const result = combineScore(fa, fb, penalty, colour, ssim(fa.ssimStats, fb.ssimStats));
        if (result.score >= this.minScore) {
          this.pairs.push({ a: indices[i], b: indices[j], score: result.score, exact: result.exact });
        }
      }
      examined += n - 1 - i;
      this.pairsDone += n - 1 - i;
    }
    if (this.row >= n - 1) this.done = true;
    return this.done;
  }
}

/**
 * Finds all pairs scoring at least `minScore`, sorted by descending score.
 * @param {MatchItem[]} items
 * @param {{ minScore?: number }} [options]
 * @returns {{ pairs: Pair[], stats: PairMatcher['stats'] }}
 */
export function findPairs(items, options = {}) {
  const matcher = new PairMatcher(items, options);
  while (!matcher.step()) {
    // keep going
  }
  return { pairs: sortPairs(matcher.pairs), stats: matcher.stats };
}

/**
 * Same as {@link findPairs} but yields to the event loop between chunks.
 * @param {MatchItem[]} items
 * @param {{ minScore?: number, onProgress?: (fraction: number) => void, chunk?: number }} [options]
 */
export async function findPairsAsync(items, options = {}) {
  const matcher = new PairMatcher(items, options);
  const chunk = options.chunk ?? 400_000;
  while (!matcher.step(chunk)) {
    if (options.onProgress) options.onProgress(matcher.progress);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  if (options.onProgress) options.onProgress(1);
  return { pairs: sortPairs(matcher.pairs), stats: matcher.stats };
}

/**
 * Sorts pairs by descending score, then by indices (deterministic order).
 * @param {Pair[]} pairs
 * @returns {Pair[]}
 */
export function sortPairs(pairs) {
  return pairs.sort((p, q) => q.score - p.score || p.a - q.a || p.b - q.b);
}
