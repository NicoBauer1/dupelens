// Review state: groups at the current threshold, the suggested keeper of each
// group, the user's keep/remove decisions and the summary. Pure logic without
// DOM access, so it is unit-tested in Node.

import { groupPairs, indexPairs, pairKey } from '../engine/grouping.js';
import { suggestKeeper, keeperReason, compareKeepers } from '../engine/keeper.js';
import { compareFingerprints } from '../engine/similarity.js';

/**
 * @typedef {object} Entry one loaded file
 * @property {number} index
 * @property {string} path relative path
 * @property {number} size bytes
 * @property {number} lastModified ms since the epoch
 * @property {'pending' | 'ok' | 'skipped' | 'failed'} status
 * @property {string} [sha256]
 * @property {string} [format]
 * @property {number} [width]
 * @property {number} [height]
 * @property {string} [reason]
 * @property {boolean} [exactOnly]
 * @property {import('../engine/similarity.js').PreparedFingerprint | null} [fingerprint]
 */

/**
 * @typedef {object} GroupMember
 * @property {number} index entry index
 * @property {number} score score against the suggested keeper (100 for the keeper)
 * @property {boolean} keeper
 */

/**
 * @typedef {object} Group
 * @property {string} key stable identity: sorted member indices
 * @property {GroupMember[]} members keeper first, then by descending score
 * @property {number} keeperIndex
 * @property {string} keeperReason why the keeper was suggested
 * @property {number} minScore lowest score against the keeper
 */

export const SORT_ORDERS = Object.freeze({
  savings: 'Most space to free',
  size: 'Largest groups',
  lowest: 'Least similar first',
  path: 'Path',
});

export class ReviewSession {
  /**
   * @param {Entry[]} entries
   * @param {import('../engine/matcher.js').Pair[]} pairs sorted by descending score
   */
  constructor(entries, pairs) {
    this.entries = entries;
    this.pairs = pairs;
    this.pairIndex = indexPairs(pairs);
    this.threshold = 90;
    /** @type {Group[]} */
    this.groups = [];
    /** @type {Map<number, 'keep' | 'remove'>} explicit per-file decisions */
    this.decisions = new Map();
    /** @type {Map<string, 'reviewed' | 'not-duplicates'>} */
    this.groupStatus = new Map();
    this.sortOrder = 'savings';
  }

  /**
   * Score of two entries, from the cache or computed when needed (members of a
   * group are not necessarily direct pairs).
   * @param {number} a
   * @param {number} b
   */
  score(a, b) {
    if (a === b) return 100;
    const ea = this.entries[a];
    const eb = this.entries[b];
    if (ea.sha256 && ea.sha256 === eb.sha256) return 100;
    const cached = this.pairIndex.get(pairKey(a, b));
    if (cached) return cached.score;
    if (ea.fingerprint && eb.fingerprint) return compareFingerprints(ea.fingerprint, eb.fingerprint).score;
    return 0;
  }

  /** @param {number} index */
  candidate(index) {
    const e = this.entries[index];
    return {
      width: e.width || 0,
      height: e.height || 0,
      size: e.size,
      sharpness: e.fingerprint ? e.fingerprint.sharpness : 0,
      lastModified: e.lastModified,
      path: e.path,
    };
  }

  /**
   * Regroups at a new threshold. Decisions are kept per file; group statuses
   * are kept for groups whose members did not change.
   * @param {number} threshold
   */
  setThreshold(threshold) {
    this.threshold = threshold;
    const raw = groupPairs(this.entries.length, this.pairs, threshold);
    this.groups = raw.map((indices) => {
      const candidates = indices.map((i) => this.candidate(i));
      const k = suggestKeeper(candidates);
      const keeperIndex = indices[k];
      // The reason is given against the strongest competitor.
      const runnerUp = candidates.filter((_, i) => i !== k).sort(compareKeepers)[0] || candidates[k];
      const members = indices
        .map((index) => ({ index, keeper: index === keeperIndex, score: this.score(keeperIndex, index) }))
        .sort((x, y) => Number(y.keeper) - Number(x.keeper) || y.score - x.score || x.index - y.index);
      return {
        key: indices.join(','),
        members,
        keeperIndex,
        keeperReason: keeperReason(candidates[k], runnerUp),
        minScore: Math.min(...members.map((m) => m.score)),
      };
    });
    this.sort();
    return this.groups;
  }

  /** @param {keyof typeof SORT_ORDERS} order */
  setSortOrder(order) {
    this.sortOrder = order;
    this.sort();
  }

  sort() {
    const order = this.sortOrder;
    const firstPath = (g) => this.entries[g.members[0].index].path;
    const comparators = {
      savings: (a, b) => this.groupSavings(b) - this.groupSavings(a) || b.members.length - a.members.length,
      size: (a, b) => b.members.length - a.members.length || this.groupSavings(b) - this.groupSavings(a),
      lowest: (a, b) => a.minScore - b.minScore,
      path: (a, b) => (firstPath(a) < firstPath(b) ? -1 : firstPath(a) > firstPath(b) ? 1 : 0),
    };
    this.groups.sort((a, b) => comparators[order](a, b) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  }

  /** @param {Group} group */
  status(group) {
    return this.groupStatus.get(group.key) || 'suggested';
  }

  /**
   * Current decision of a file within its group.
   * @param {Group} group
   * @param {number} index
   * @returns {'keep' | 'remove'}
   */
  decision(group, index) {
    if (this.status(group) === 'not-duplicates') return 'keep';
    const explicit = this.decisions.get(index);
    if (explicit) return explicit;
    return index === group.keeperIndex ? 'keep' : 'remove';
  }

  /**
   * Flips keep/remove for one file and marks the group as reviewed.
   * @param {Group} group
   * @param {number} index
   */
  toggle(group, index) {
    const next = this.decision(group, index) === 'keep' ? 'remove' : 'keep';
    if (this.status(group) === 'not-duplicates') {
      // Leaving "keep all": start from all-keep, then apply this change.
      for (const m of group.members) this.decisions.set(m.index, 'keep');
    }
    this.decisions.set(index, next);
    this.groupStatus.set(group.key, 'reviewed');
  }

  /**
   * Accepts the current decisions of a group (the suggestion unless changed).
   * @param {Group} group
   */
  accept(group) {
    if (this.status(group) === 'not-duplicates') {
      for (const m of group.members) this.decisions.delete(m.index);
    }
    this.groupStatus.set(group.key, 'reviewed');
  }

  /**
   * "Not duplicates — keep all".
   * @param {Group} group
   */
  keepAll(group) {
    for (const m of group.members) this.decisions.delete(m.index);
    this.groupStatus.set(group.key, 'not-duplicates');
  }

  /**
   * Back to the suggestion.
   * @param {Group} group
   */
  resetGroup(group) {
    for (const m of group.members) this.decisions.delete(m.index);
    this.groupStatus.delete(group.key);
  }

  /** @param {Group} group */
  groupSavings(group) {
    let bytes = 0;
    for (const m of group.members) if (this.decision(group, m.index) === 'remove') bytes += this.entries[m.index].size;
    return bytes;
  }

  /** @param {Group} group */
  allRemoved(group) {
    return group.members.every((m) => this.decision(group, m.index) === 'remove');
  }

  summary() {
    let filesInGroups = 0;
    let toRemove = 0;
    let bytes = 0;
    let reviewed = 0;
    let allRemoved = 0;
    for (const group of this.groups) {
      filesInGroups += group.members.length;
      if (this.status(group) !== 'suggested') reviewed++;
      if (this.allRemoved(group)) allRemoved++;
      for (const m of group.members) {
        if (this.decision(group, m.index) === 'remove') {
          toRemove++;
          bytes += this.entries[m.index].size;
        }
      }
    }
    const skipped = this.entries.filter((e) => e.status === 'skipped' || e.status === 'failed').length;
    return { groups: this.groups.length, reviewed, filesInGroups, toRemove, bytes, allRemoved, skipped, total: this.entries.length };
  }

  /**
   * Report for the JSON/CSV exports and the move scripts.
   * @param {{ version: string, createdAt: string, formatLabel?: (format: string) => string }} meta
   * @returns {import('../export/report.js').Report}
   */
  report(meta) {
    const label = meta.formatLabel || ((f) => f);
    return {
      version: meta.version,
      createdAt: meta.createdAt,
      threshold: this.threshold,
      groups: this.groups.map((group, g) => ({
        id: g + 1,
        status: this.status(group),
        members: group.members.map((m) => {
          const e = this.entries[m.index];
          return {
            path: e.path,
            decision: this.decision(group, m.index),
            suggestedKeeper: m.keeper,
            scoreVsKeeper: m.score,
            size: e.size,
            width: e.width || 0,
            height: e.height || 0,
            format: label(e.format || 'unknown'),
            lastModified: e.lastModified,
            sha256: e.sha256 || '',
          };
        }),
      })),
      skipped: this.entries
        .filter((e) => e.status === 'skipped' || e.status === 'failed')
        .map((e) => ({ path: e.path, reason: e.reason || '' })),
    };
  }
}
