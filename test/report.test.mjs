import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csvField, reportToCsv, reportToJson, pathsToRemove, CSV_COLUMNS } from '../src/export/report.js';

const member = (path, decision, extra = {}) => ({
  path,
  decision,
  suggestedKeeper: decision === 'keep',
  scoreVsKeeper: decision === 'keep' ? 100 : 97.25,
  size: 1000,
  width: 4000,
  height: 3000,
  format: 'JPEG',
  lastModified: Date.UTC(2024, 0, 2, 3, 4, 5),
  sha256: 'ab'.repeat(32),
  ...extra,
});

const report = {
  version: '0.1.0',
  createdAt: '2026-11-24T10:00:00.000Z',
  threshold: 90,
  groups: [
    { id: 1, status: 'reviewed', members: [member('Trip/a.jpg', 'keep'), member('Trip/a (1).jpg', 'remove', { size: 800 })] },
    { id: 2, status: 'not-duplicates', members: [member('x.jpg', 'keep'), member('y.jpg', 'keep')] },
  ],
  skipped: [{ path: 'clip.mov', reason: 'Videos are not analysed.' }],
};

test('CSV fields are quoted where needed and formulas are neutralised', () => {
  assert.equal(csvField('plain'), 'plain');
  assert.equal(csvField('a,b'), '"a,b"');
  assert.equal(csvField('say "hi"'), '"say ""hi"""');
  assert.equal(csvField('two\nlines'), '"two\nlines"');
  assert.equal(csvField('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(csvField('+1'), "'+1");
  assert.equal(csvField('-dash.jpg'), "'-dash.jpg");
  assert.equal(csvField('@home'), "'@home");
  assert.equal(csvField(null), '');
  assert.equal(csvField(42), '42');
});

test('CSV report has one row per group member', () => {
  const csv = reportToCsv(report);
  const lines = csv.trimEnd().split('\r\n');
  assert.equal(lines[0], CSV_COLUMNS.join(','));
  assert.equal(lines.length, 5);
  assert.equal(lines[2], "1,reviewed,remove,no,97.3,Trip/a (1).jpg,800,4000,3000,JPEG,2024-01-02T03:04:05.000Z," + 'ab'.repeat(32));
});

test('JSON report contains a summary and round-trips', () => {
  const parsed = JSON.parse(reportToJson(report));
  assert.equal(parsed.tool, 'DupeLens');
  assert.deepEqual(parsed.summary, { groups: 2, reviewedGroups: 2, filesInGroups: 4, filesToRemove: 1, bytesToFree: 800, skippedFiles: 1 });
  assert.equal(parsed.groups[0].members[1].scoreVsKeeper, 97.3);
  assert.equal(parsed.groups[0].members[0].lastModified, '2024-01-02T03:04:05.000Z');
  assert.deepEqual(parsed.skipped, report.skipped);
});

test('pathsToRemove lists only files marked remove', () => {
  assert.deepEqual(pathsToRemove(report), ['Trip/a (1).jpg']);
});
