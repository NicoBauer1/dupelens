import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ReviewSession } from '../src/app/review.js';
import { findPairs } from '../src/engine/matcher.js';
import { analyse } from '../tools/lib/calibration.mjs';
import * as synth from '../tools/lib/synth.mjs';

const big = synth.renderScene('seascape', 77, 320, 240);
const other = synth.renderScene('stillLife', 78, 320, 240);
const images = [
  { image: big, path: 'Trip/sea.png', size: 300_000, lastModified: 2000 },
  { image: synth.resize(big, 0.5), path: 'Trip/sea-small.png', size: 90_000, lastModified: 1000 },
  { image: synth.jpegLike(big, 70), path: 'Trip/copy/sea.png', size: 280_000, lastModified: 3000 },
  { image: other, path: 'Trip/fruit.png', size: 200_000, lastModified: 4000 },
  { image: synth.brightness(other, 0.05), path: 'Trip/fruit-bright.png', size: 210_000, lastModified: 5000 },
  { image: synth.renderScene('city', 79, 320, 240), path: 'Trip/city.png', size: 150_000, lastModified: 6000 },
];

function makeSession() {
  const entries = images.map((item, index) => {
    const fingerprint = analyse(item.image);
    return {
      index,
      path: item.path,
      size: item.size,
      lastModified: item.lastModified,
      status: 'ok',
      sha256: `sha-${index}`,
      format: 'png',
      width: item.image.width,
      height: item.image.height,
      fingerprint,
    };
  });
  entries.push({ index: 6, path: 'Trip/clip.mov', size: 5, lastModified: 0, status: 'skipped', reason: 'Videos are not analysed.', fingerprint: null });
  const { pairs } = findPairs(entries.map((e) => ({ sha256: e.sha256 || null, fingerprint: e.fingerprint || null })));
  return new ReviewSession(entries, pairs);
}

test('groups, keeper suggestion and scores at the default threshold', () => {
  const session = makeSession();
  const groups = session.setThreshold(90);
  assert.equal(groups.length, 2);
  const sea = groups.find((g) => g.members.some((m) => m.index === 0));
  assert.equal(sea.keeperIndex, 0, 'highest resolution, then larger file');
  assert.equal(sea.members[0].index, 0);
  assert.equal(sea.members[0].score, 100);
  assert.ok(sea.members.slice(1).every((m) => m.score >= 90 && m.score < 100));
  const fruit = groups.find((g) => g.members.some((m) => m.index === 3));
  assert.equal(fruit.keeperIndex, 4, 'same resolution: the larger file wins');
  assert.equal(fruit.keeperReason, 'larger file');
});

test('default decisions keep the keeper and remove the rest; summary adds up', () => {
  const session = makeSession();
  session.setThreshold(90);
  const s = session.summary();
  assert.equal(s.groups, 2);
  assert.equal(s.filesInGroups, 5);
  assert.equal(s.toRemove, 3);
  assert.equal(s.bytes, 90_000 + 280_000 + 200_000);
  assert.equal(s.reviewed, 0);
  assert.equal(s.skipped, 1);
});

test('toggle, accept, keep all and reset', () => {
  const session = makeSession();
  session.setThreshold(90);
  const sea = session.groups.find((g) => g.keeperIndex === 0);
  session.toggle(sea, 2);
  assert.equal(session.decision(sea, 2), 'keep');
  assert.equal(session.status(sea), 'reviewed');
  session.keepAll(sea);
  assert.ok(sea.members.every((m) => session.decision(sea, m.index) === 'keep'));
  assert.equal(session.status(sea), 'not-duplicates');
  session.toggle(sea, 1);
  assert.equal(session.decision(sea, 1), 'remove', 'leaving keep-all starts from all kept');
  assert.equal(session.decision(sea, 2), 'keep');
  session.resetGroup(sea);
  assert.equal(session.status(sea), 'suggested');
  assert.equal(session.decision(sea, 2), 'remove');
  session.accept(sea);
  assert.equal(session.summary().reviewed, 1);
});

test('decisions survive a threshold change; statuses of changed groups reset', () => {
  const session = makeSession();
  session.setThreshold(90);
  const sea = session.groups.find((g) => g.keeperIndex === 0);
  session.toggle(sea, 1);
  session.setThreshold(99.95);
  session.setThreshold(90);
  const again = session.groups.find((g) => g.keeperIndex === 0);
  assert.equal(session.decision(again, 1), 'keep');
  assert.equal(session.status(again), 'reviewed', 'same members, same status');
});

test('flags groups in which every copy is marked for removal', () => {
  const session = makeSession();
  session.setThreshold(90);
  const fruit = session.groups.find((g) => g.keeperIndex === 4);
  session.toggle(fruit, 4);
  assert.ok(session.allRemoved(fruit));
  assert.equal(session.summary().allRemoved, 1);
});

test('sort orders', () => {
  const session = makeSession();
  session.setThreshold(90);
  session.setSortOrder('size');
  assert.equal(session.groups[0].members.length, 3);
  session.setSortOrder('lowest');
  assert.ok(session.groups[0].minScore <= session.groups[1].minScore);
  session.setSortOrder('path');
  assert.equal(session.entries[session.groups[0].members[0].index].path < session.entries[session.groups[1].members[0].index].path, true);
});

test('the report lists groups, decisions and skipped files', () => {
  const session = makeSession();
  session.setThreshold(90);
  const report = session.report({ version: '0.1.0', createdAt: '2026-11-24T00:00:00.000Z' });
  assert.equal(report.groups.length, 2);
  assert.equal(report.threshold, 90);
  assert.deepEqual(report.skipped, [{ path: 'Trip/clip.mov', reason: 'Videos are not analysed.' }]);
  const removed = report.groups.flatMap((g) => g.members.filter((m) => m.decision === 'remove').map((m) => m.path)).sort();
  assert.deepEqual(removed, ['Trip/copy/sea.png', 'Trip/fruit.png', 'Trip/sea-small.png']);
});
