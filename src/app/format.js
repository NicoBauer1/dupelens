// Formatting helpers for the user interface.

/**
 * @param {number} bytes
 * @returns {string} e.g. "1.4 MB"
 */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1000) return `${bytes} B`;
  const units = ['kB', 'MB', 'GB', 'TB'];
  let value = bytes / 1000;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/**
 * @param {number} ms milliseconds since the epoch
 * @returns {string} e.g. "2024-01-02 03:04"
 */
export function formatDate(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * @param {number} count
 * @param {string} singular
 * @param {string} [plural]
 */
export function plural(count, singular, plural = `${singular}s`) {
  return `${count.toLocaleString('en')} ${count === 1 ? singular : plural}`;
}

/**
 * @param {number} score 0..100
 * @returns {string} e.g. "97.3 %" or "100 %"
 */
export function formatScore(score) {
  return score >= 100 ? '100 %' : `${score.toFixed(1)} %`;
}

/**
 * @param {number} width
 * @param {number} height
 */
export function formatResolution(width, height) {
  if (!width || !height) return '—';
  const mp = (width * height) / 1e6;
  return `${width} × ${height}${mp >= 0.1 ? ` (${mp.toFixed(1)} MP)` : ''}`;
}

/**
 * @param {number} seconds
 */
export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m} min ${String(s).padStart(2, '0')} s`;
}
