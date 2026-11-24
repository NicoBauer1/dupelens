// Asserts the documented bands of the similarity scale on the synthetic
// transform suite (see docs/similarity.md). The suite is deterministic, so a
// failure here means the score model or a fingerprint changed behaviour.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCalibration, BANDS } from '../tools/lib/calibration.mjs';

const { rows } = runCalibration({ seedsPerType: 2, includeInfo: false });

for (const row of rows) {
  const band = BANDS[row.band];
  test(`${row.label}: ${band.label} (${row.count} pairs)`, () => {
    if (band.min !== undefined) {
      const worst = row.samples.reduce((a, b) => (b.score < a.score ? b : a));
      assert.ok(row.min >= band.min, `min ${row.min} < ${band.min} for ${worst.type}#${worst.seed}`);
    }
    if (band.max !== undefined) {
      const worst = row.samples.reduce((a, b) => (b.score > a.score ? b : a));
      assert.ok(row.max <= band.max, `max ${row.max} > ${band.max} for ${worst.a} vs ${worst.b}`);
    }
  });
}

test('unrelated images stay clearly below the default threshold on average', () => {
  const unrelated = rows.find((row) => row.band === 'unrelated');
  assert.ok(unrelated.median < 40, `median ${unrelated.median}`);
});

test('pixel-identical copies are flagged as exact pixel matches', () => {
  const copy = rows.find((row) => row.id === 'copy');
  for (const sample of copy.samples) assert.equal(sample.exact, 'pixels');
});
