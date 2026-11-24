// Which copy should be kept? The suggestion is deterministic and documented:
//
//   1. highest resolution (width × height)
//   2. larger file (usually less compression)
//   3. sharper image (variance of the Laplacian; only compared between images
//      of the same resolution, which is the only case in which it is reached)
//   4. older file (earlier last-modified date — likely the original)
//   5. shorter, then alphabetically first relative path (stable tie-breaker)
//
// The suggestion is only a starting point: users decide per image.

/**
 * @typedef {object} KeeperCandidate
 * @property {number} width
 * @property {number} height
 * @property {number} size bytes
 * @property {number} sharpness
 * @property {number} lastModified milliseconds since the epoch
 * @property {string} path relative path
 */

/**
 * Compares two candidates; negative if `a` is the better keeper.
 * @param {KeeperCandidate} a
 * @param {KeeperCandidate} b
 * @returns {number}
 */
export function compareKeepers(a, b) {
  const pixels = b.width * b.height - a.width * a.height;
  if (pixels !== 0) return pixels;
  if (b.size !== a.size) return b.size - a.size;
  const sharpest = Math.max(a.sharpness, b.sharpness);
  if (sharpest > 0 && Math.abs(a.sharpness - b.sharpness) > sharpest * 1e-6) return b.sharpness - a.sharpness;
  if (a.lastModified !== b.lastModified) return a.lastModified - b.lastModified;
  if (a.path.length !== b.path.length) return a.path.length - b.path.length;
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

/**
 * Index of the suggested keeper within `candidates`.
 * @param {KeeperCandidate[]} candidates
 * @returns {number}
 */
export function suggestKeeper(candidates) {
  let best = 0;
  for (let i = 1; i < candidates.length; i++) {
    if (compareKeepers(candidates[i], candidates[best]) < 0) best = i;
  }
  return best;
}

/**
 * Human-readable reason why `winner` was preferred over `other`.
 * @param {KeeperCandidate} winner
 * @param {KeeperCandidate} other
 * @returns {string}
 */
export function keeperReason(winner, other) {
  if (winner.width * winner.height !== other.width * other.height) return 'higher resolution';
  if (winner.size !== other.size) return 'larger file';
  const sharpest = Math.max(winner.sharpness, other.sharpness);
  if (sharpest > 0 && Math.abs(winner.sharpness - other.sharpness) > sharpest * 1e-6) return 'sharper';
  if (winner.lastModified !== other.lastModified) return 'older file';
  return 'same quality — first by path';
}
