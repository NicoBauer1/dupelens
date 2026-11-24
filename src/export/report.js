// Decision reports as JSON and CSV.

/** Columns of the CSV export, in order. */
export const CSV_COLUMNS = [
  'group',
  'group_status',
  'decision',
  'suggested_keeper',
  'score_vs_keeper',
  'path',
  'size_bytes',
  'width',
  'height',
  'format',
  'last_modified',
  'sha256',
];

/**
 * One CSV field, quoted where needed. Fields that a spreadsheet would evaluate as a
 * formula (starting with = + - @ or a tab/carriage return) get a leading
 * apostrophe, so a file called "=HYPERLINK(...).jpg" stays plain text.
 * @param {unknown} value
 * @returns {string}
 */
export function csvField(value) {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * @typedef {object} ReportMember
 * @property {string} path
 * @property {'keep' | 'remove'} decision
 * @property {boolean} suggestedKeeper
 * @property {number} scoreVsKeeper 0..100
 * @property {number} size
 * @property {number} width
 * @property {number} height
 * @property {string} format
 * @property {number} lastModified ms since the epoch
 * @property {string} sha256
 */

/**
 * @typedef {object} ReportGroup
 * @property {number} id 1-based
 * @property {'suggested' | 'reviewed' | 'not-duplicates'} status
 * @property {ReportMember[]} members
 */

/**
 * @typedef {object} Report
 * @property {string} version DupeLens version
 * @property {string} createdAt ISO timestamp
 * @property {number} threshold
 * @property {ReportGroup[]} groups
 * @property {Array<{ path: string, reason: string }>} skipped
 */

/**
 * @param {Report} report
 * @returns {string}
 */
export function reportToCsv(report) {
  const rows = [CSV_COLUMNS.join(',')];
  for (const group of report.groups) {
    for (const m of group.members) {
      rows.push(
        [
          group.id,
          group.status,
          m.decision,
          m.suggestedKeeper ? 'yes' : 'no',
          m.scoreVsKeeper.toFixed(1),
          m.path,
          m.size,
          m.width,
          m.height,
          m.format,
          Number.isFinite(m.lastModified) ? new Date(m.lastModified).toISOString() : '',
          m.sha256,
        ]
          .map(csvField)
          .join(','),
      );
    }
  }
  return rows.join('\r\n') + '\r\n';
}

/**
 * @param {Report} report
 * @returns {string}
 */
export function reportToJson(report) {
  const toRemove = report.groups.flatMap((g) => g.members.filter((m) => m.decision === 'remove'));
  const out = {
    tool: 'DupeLens',
    version: report.version,
    createdAt: report.createdAt,
    threshold: report.threshold,
    summary: {
      groups: report.groups.length,
      reviewedGroups: report.groups.filter((g) => g.status !== 'suggested').length,
      filesInGroups: report.groups.reduce((n, g) => n + g.members.length, 0),
      filesToRemove: toRemove.length,
      bytesToFree: toRemove.reduce((n, m) => n + m.size, 0),
      skippedFiles: report.skipped.length,
    },
    groups: report.groups.map((g) => ({
      id: g.id,
      status: g.status,
      members: g.members.map((m) => ({
        path: m.path,
        decision: m.decision,
        suggestedKeeper: m.suggestedKeeper,
        scoreVsKeeper: Math.round(m.scoreVsKeeper * 10) / 10,
        size: m.size,
        width: m.width,
        height: m.height,
        format: m.format,
        lastModified: Number.isFinite(m.lastModified) ? new Date(m.lastModified).toISOString() : null,
        sha256: m.sha256,
      })),
    })),
    skipped: report.skipped,
  };
  return JSON.stringify(out, null, 2) + '\n';
}

/**
 * Relative paths of all files marked "remove", in group order.
 * @param {Report} report
 * @returns {string[]}
 */
export function pathsToRemove(report) {
  return report.groups.flatMap((g) => g.members.filter((m) => m.decision === 'remove').map((m) => m.path));
}
