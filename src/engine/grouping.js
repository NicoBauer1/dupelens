// Grouping of matched pairs with a disjoint-set forest (union-find with path
// halving and union by size). Changing the threshold only replays the cached,
// score-sorted pair list — no image is analysed again.

export class DisjointSet {
  /** @param {number} size */
  constructor(size) {
    this.parent = Int32Array.from({ length: size }, (_, i) => i);
    this.size = new Int32Array(size).fill(1);
  }

  /** @param {number} x */
  find(x) {
    const parent = this.parent;
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  }

  /**
   * @param {number} a
   * @param {number} b
   * @returns {boolean} true if two different sets were merged
   */
  union(a, b) {
    let ra = this.find(a);
    let rb = this.find(b);
    if (ra === rb) return false;
    if (this.size[ra] < this.size[rb]) [ra, rb] = [rb, ra];
    this.parent[rb] = ra;
    this.size[ra] += this.size[rb];
    return true;
  }
}

/**
 * Groups items connected by pairs with `score >= threshold`.
 * @param {number} itemCount
 * @param {import('./matcher.js').Pair[]} sortedPairs pairs sorted by descending score
 * @param {number} threshold 0..100
 * @returns {number[][]} groups of at least two item indices; members ascending,
 *   groups ordered by their smallest member
 */
export function groupPairs(itemCount, sortedPairs, threshold) {
  const sets = new DisjointSet(itemCount);
  for (const pair of sortedPairs) {
    if (pair.score < threshold) break;
    sets.union(pair.a, pair.b);
  }
  /** @type {Map<number, number[]>} */
  const byRoot = new Map();
  for (let i = 0; i < itemCount; i++) {
    if (sets.size[sets.find(i)] < 2) continue;
    const root = sets.find(i);
    const list = byRoot.get(root);
    if (list) list.push(i);
    else byRoot.set(root, [i]);
  }
  return [...byRoot.values()].sort((x, y) => x[0] - y[0]);
}

/**
 * Lookup table for cached pair scores.
 * @param {import('./matcher.js').Pair[]} pairs
 * @returns {Map<string, import('./matcher.js').Pair>}
 */
export function indexPairs(pairs) {
  const map = new Map();
  for (const pair of pairs) map.set(pairKey(pair.a, pair.b), pair);
  return map;
}

/**
 * @param {number} a
 * @param {number} b
 */
export function pairKey(a, b) {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}
