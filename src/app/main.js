// DupeLens application controller: loading, analysis, matching and review.

import { h, byId, downloadText, isTypingTarget, preferences } from './dom.js';
import { icon, hydrateIcons } from './icons.js';
import { AnalysisPool } from './pool.js';
import { filesFromInput, filesFromDrop } from './loader.js';
import { ReviewSession, SORT_ORDERS } from './review.js';
import { CompareView } from './compare.js';
import { formatBytes, formatDate, plural, formatScore, formatResolution, formatDuration } from './format.js';
import { APP_VERSION } from './version.js';
import { findPairsAsync } from '../engine/matcher.js';
import { prepareFingerprint, MIN_SCORE } from '../engine/similarity.js';
import { FORMAT_LABELS } from '../engine/imageinfo.js';
import { reportToCsv, reportToJson, pathsToRemove } from '../export/report.js';
import { powerShellScript, shellScript, describeRunLocation, DEFAULT_REVIEW_FOLDER } from '../export/scripts.js';

const BATCH = 20; // group cards rendered per step
const PRESETS = [100, 95, 90, 80];

const state = {
  /** @type {Array<import('./review.js').Entry & { file: File | null }>} */
  entries: [],
  /** @type {Set<string>} */
  seen: new Set(),
  /** @type {AnalysisPool | null} */
  pool: null,
  /** @type {ReviewSession | null} */
  session: null,
  rendered: 0,
  current: -1,
  cancel: { cancelled: false },
  /** @type {Map<number, string>} */
  urls: new Map(),
  busy: false,
  loads: 0,
};

const ui = {};

function cacheElements() {
  for (const id of [
    'start-view', 'progress-view', 'review-view', 'dropzone', 'folder-input', 'file-input', 'add-input',
    'folder-button', 'file-button', 'add-button', 'progress-bar', 'progress-text', 'progress-title',
    'progress-mode', 'cancel-button', 'threshold', 'threshold-value', 'summary', 'sort-order',
    'export-button', 'restart-button', 'groups', 'groups-sentinel', 'skipped', 'skipped-summary',
    'skipped-list', 'engine-mode', 'app-version', 'announcer', 'theme-toggle', 'help-button',
    'compare-dialog', 'export-dialog', 'export-body', 'help-dialog', 'main',
  ]) {
    ui[id.replace(/-(\w)/g, (_, c) => c.toUpperCase())] = byId(id);
  }
}

// ---------------------------------------------------------------------------
// Views and small helpers

function showView(name) {
  ui.startView.hidden = name !== 'start';
  ui.progressView.hidden = name !== 'progress';
  ui.reviewView.hidden = name !== 'review';
}

function announce(text) {
  ui.announcer.textContent = '';
  // A separate task makes screen readers announce repeated messages too.
  setTimeout(() => {
    ui.announcer.textContent = text;
  }, 30);
}

function urlFor(index) {
  const entry = state.entries[index];
  // Only decoded images get a preview; undecodable files would show a broken image.
  if (!entry || !entry.file || entry.status !== 'ok') return null;
  let url = state.urls.get(index);
  if (!url) {
    url = URL.createObjectURL(entry.file);
    state.urls.set(index, url);
  }
  return url;
}

function releaseUrls() {
  for (const url of state.urls.values()) URL.revokeObjectURL(url);
  state.urls.clear();
}

function formatLabel(format) {
  return FORMAT_LABELS[format] || format || '—';
}

// ---------------------------------------------------------------------------
// Theme

const THEMES = ['system', 'light', 'dark'];

function applyTheme(theme) {
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
  ui.themeToggle.setAttribute('aria-label', `Colour theme: ${theme} (click to change)`);
  ui.themeToggle.title = `Theme: ${theme}`;
}

function initTheme() {
  const saved = preferences.get('dupelens-theme');
  applyTheme(THEMES.includes(saved) ? saved : 'system');
  ui.themeToggle.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') || 'system';
    const next = THEMES[(THEMES.indexOf(current) + 1) % THEMES.length];
    applyTheme(next);
    preferences.set('dupelens-theme', next);
    announce(`Theme: ${next}`);
  });
}

// ---------------------------------------------------------------------------
// Loading and analysis

async function ensurePool() {
  if (state.pool) return state.pool;
  const pool = new AnalysisPool();
  const params = new URLSearchParams(globalThis.location ? location.search : '');
  await pool.start({ forceMainThread: params.get('workers') === '0' });
  state.pool = pool;
  ui.engineMode.textContent = pool.mode === 'workers' ? `Analysis in ${pool.reason}` : 'Analysis on the main thread';
  ui.engineMode.title = pool.mode === 'workers' ? '' : pool.reason;
  return pool;
}

/**
 * @param {import('./loader.js').LoadedFile[]} loaded
 */
async function addFiles(loaded) {
  if (state.busy) return;
  const fresh = [];
  for (const item of loaded) {
    const key = `${item.path}\u0000${item.file.size}\u0000${item.file.lastModified}`;
    if (state.seen.has(key)) continue;
    state.seen.add(key);
    fresh.push(item);
  }
  if (!fresh.length) {
    announce(loaded.length ? 'These files are already loaded.' : 'No files found.');
    return;
  }
  state.busy = true;
  state.loads++;
  state.cancel = { cancelled: false };
  const first = state.entries.length;
  for (const item of fresh) {
    state.entries.push({
      index: state.entries.length,
      path: item.path,
      size: item.file.size,
      lastModified: item.file.lastModified,
      status: 'pending',
      file: item.file,
      fingerprint: null,
    });
  }

  showView('progress');
  ui.progressTitle.textContent = 'Analysing photos…';
  ui.progressBar.value = 0;
  let pool;
  try {
    pool = await ensurePool();
  } catch (error) {
    ui.progressText.textContent = String(error.message || error);
    state.busy = false;
    return;
  }
  ui.progressMode.textContent = pool.mode === 'workers'
    ? `Using ${pool.reason} in parallel.`
    : `Analysing on the main thread: ${pool.reason}`;

  const jobs = fresh.map((item) => ({ file: item.file, name: item.file.name }));
  const started = performance.now();
  let done = 0;
  let skipped = 0;
  let frame = 0;
  const update = () => {
    frame = 0;
    const elapsed = (performance.now() - started) / 1000;
    const rate = done / Math.max(elapsed, 0.001);
    const left = rate > 0 ? (jobs.length - done) / rate : NaN;
    ui.progressBar.value = done / jobs.length;
    ui.progressText.textContent = `${done.toLocaleString('en')} of ${plural(jobs.length, 'file')} analysed` +
      (skipped ? ` · ${skipped.toLocaleString('en')} skipped` : '') +
      (done > 5 && done < jobs.length ? ` · about ${formatDuration(left)} left` : '');
  };
  update();

  await pool.run(jobs, (k, result, error) => {
    const entry = state.entries[first + k];
    if (!result) {
      entry.status = 'failed';
      entry.reason = `Could not be read (${error ? error.message : 'unknown error'}).`;
      skipped++;
    } else {
      Object.assign(entry, {
        status: result.status,
        sha256: result.sha256,
        format: result.format,
        width: result.width,
        height: result.height,
        reason: result.reason,
        exactOnly: result.exactOnly,
        fingerprint: result.fingerprint ? prepareFingerprint({ ...result.fingerprint, sha256: result.sha256 }) : null,
      });
      if (result.status !== 'ok') skipped++;
    }
    done++;
    if (!frame) frame = requestAnimationFrame(update);
  }, state.cancel);
  update();

  if (state.cancel.cancelled) {
    // Forget the files that were not analysed, keep the ones that were.
    const keep = state.entries.filter((e) => e.status !== 'pending');
    for (const e of state.entries.slice(first)) if (e.status === 'pending') state.seen.delete(`${e.path}\u0000${e.size}\u0000${e.lastModified}`);
    state.entries = keep.map((e, i) => ({ ...e, index: i }));
    releaseUrls();
  }

  await match();
  state.busy = false;
}

async function match() {
  ui.progressTitle.textContent = 'Comparing photos…';
  ui.progressBar.value = 0;
  ui.progressText.textContent = 'Comparing every photo with every other photo…';
  const items = state.entries.map((e) => ({
    sha256: e.status === 'ok' || e.exactOnly ? e.sha256 || null : null,
    fingerprint: e.status === 'ok' ? e.fingerprint : null,
  }));
  const { pairs } = await findPairsAsync(items, {
    minScore: MIN_SCORE,
    onProgress: (fraction) => {
      ui.progressBar.value = fraction;
      ui.progressText.textContent = `Comparing photos… ${Math.round(fraction * 100)} %`;
    },
  });

  const previous = state.session;
  const session = new ReviewSession(state.entries, pairs);
  if (previous) {
    // Earlier files keep their indices, so their decisions carry over.
    session.decisions = previous.decisions;
    session.groupStatus = previous.groupStatus;
    session.sortOrder = previous.sortOrder;
  }
  session.setThreshold(previous ? previous.threshold : Number(ui.threshold.value));
  state.session = session;
  state.current = -1;
  showView('review');
  renderAll();
  const s = session.summary();
  announce(`Analysis finished. ${plural(s.groups, 'group')} of duplicates found at ${formatScore(session.threshold)}.`);
  ui.main.focus();
}

// ---------------------------------------------------------------------------
// Review rendering

function renderAll() {
  renderThreshold();
  renderSummary();
  renderGroups();
  renderSkipped();
}

function renderThreshold() {
  const t = state.session ? state.session.threshold : Number(ui.threshold.value);
  ui.threshold.value = String(t);
  ui.thresholdValue.textContent = formatScore(t);
  ui.threshold.setAttribute('aria-valuetext', `${formatScore(t)}`);
  for (const chip of document.querySelectorAll('[data-preset]')) {
    chip.setAttribute('aria-pressed', String(Number(chip.getAttribute('data-preset')) === t));
  }
}

function renderSummary() {
  const s = state.session.summary();
  const item = (label, value) => h('div', {}, h('dt', { text: label }), h('dd', { text: value }));
  ui.summary.replaceChildren(
    item('Groups', s.groups.toLocaleString('en')),
    item('Reviewed', `${s.reviewed.toLocaleString('en')} / ${s.groups.toLocaleString('en')}`),
    item('Marked for removal', s.toRemove.toLocaleString('en')),
    item('Space to free', formatBytes(s.bytes)),
    item('Files loaded', s.total.toLocaleString('en')),
  );
}

function renderGroups() {
  ui.groups.replaceChildren();
  state.rendered = 0;
  if (!state.session.groups.length) {
    ui.groups.append(
      h('div', { class: 'empty' },
        h('p', { text: `No duplicates at ${formatScore(state.session.threshold)}.` }),
        h('p', { class: 'muted', text: 'Lower the threshold or try the "Similar shots" preset to see less similar photos.' }),
      ),
    );
    return;
  }
  renderMore();
}

function renderMore(until = 0) {
  const groups = state.session.groups;
  const end = Math.min(groups.length, Math.max(state.rendered + BATCH, until + 1));
  const fragment = document.createDocumentFragment();
  for (let g = state.rendered; g < end; g++) fragment.append(groupCard(g));
  ui.groups.append(fragment);
  state.rendered = end;
}

function refreshCard(g) {
  const old = ui.groups.querySelector(`[data-group="${g}"]`);
  if (!old) return;
  const fresh = groupCard(g);
  if (old.classList.contains('current')) fresh.classList.add('current');
  const hadFocus = old.contains(document.activeElement);
  const focusKey = hadFocus && document.activeElement instanceof HTMLElement ? document.activeElement.dataset.focusKey : null;
  old.replaceWith(fresh);
  if (hadFocus) {
    const target = (focusKey && fresh.querySelector(`[data-focus-key="${focusKey}"]`)) || fresh;
    target.focus({ preventScroll: true });
  }
  renderSummary();
}

function statusBadge(status) {
  const text = { suggested: 'Suggestion', reviewed: 'Reviewed', 'not-duplicates': 'Not duplicates' }[status];
  return h('span', { class: `badge ${status}` }, status === 'reviewed' ? icon('keep') : null, text);
}

function describeEntry(index) {
  const e = state.entries[index];
  const fact = (label, value, title) => [h('dt', { text: label }), h('dd', { text: value, title })];
  return h('dl', { class: 'facts' },
    ...fact('Resolution', formatResolution(e.width, e.height)),
    ...fact('Size', formatBytes(e.size)),
    ...fact('Format', formatLabel(e.format)),
    ...fact('Modified', formatDate(e.lastModified)),
    ...fact('Path', e.path, e.path),
  );
}

function groupCard(g) {
  const session = state.session;
  const group = session.groups[g];
  const status = session.status(group);
  const titleId = `group-title-${g}`;
  const savings = session.groupSavings(group);
  const card = h('article', { class: 'group', tabindex: '-1', 'aria-labelledby': titleId, dataset: { group: String(g) } });
  if (g === state.current) card.classList.add('current');

  const actions = h('div', { class: 'group-actions' },
    h('button', { type: 'button', class: 'button', 'data-focus-key': 'compare', 'aria-keyshortcuts': 'c', onclick: () => openCompare(g) }, icon('compare'), 'Compare'),
    h('button', { type: 'button', class: 'button', 'data-focus-key': 'accept', 'aria-keyshortcuts': 'a', onclick: () => accept(g) }, icon('check'), status === 'reviewed' ? 'Reviewed' : 'Accept'),
    h('button', { type: 'button', class: 'button', 'data-focus-key': 'keepall', 'aria-keyshortcuts': 'n', 'aria-pressed': String(status === 'not-duplicates'), onclick: () => keepAll(g) }, icon('equal'), 'Not duplicates — keep all'),
    status !== 'suggested'
      ? h('button', { type: 'button', class: 'button', 'data-focus-key': 'reset', 'aria-keyshortcuts': 'u', onclick: () => resetGroup(g) }, icon('undo'), 'Undo')
      : null,
  );

  card.append(
    h('header', { class: 'group-header' },
      h('h3', { class: 'group-title', id: titleId, text: `Group ${g + 1} of ${session.groups.length}` }),
      h('span', { class: 'group-meta', text: `${plural(group.members.length, 'photo')} · ${formatBytes(savings)} to free · lowest score ${formatScore(group.minScore)}` }),
      statusBadge(status),
      session.allRemoved(group) ? h('span', { class: 'badge warning' }, icon('warning'), 'Every copy is marked for removal') : null,
      actions,
    ),
  );

  const tiles = h('div', { class: 'tiles' });
  group.members.forEach((member, n) => {
    const e = state.entries[member.index];
    const decision = session.decision(group, member.index);
    const url = urlFor(member.index);
    const label = `Photo ${n + 1}: ${e.path}`;
    const thumb = h('button', { type: 'button', class: 'thumb', 'aria-label': `Compare photo ${n + 1} with the keeper`, onclick: () => openCompare(g, member.index) },
      url
        ? h('img', { src: url, alt: label, loading: 'lazy', decoding: 'async' })
        : h('span', { class: 'placeholder', text: e.reason || 'No preview' }),
      h('span', { class: 'tile-number', text: n < 9 ? String(n + 1) : '·' }),
    );
    const head = h('div', { class: 'tile-head' },
      member.keeper
        ? h('span', { class: 'badge keeper', title: `Suggested because of: ${group.keeperReason}` }, icon('star'), `Suggested keeper (${group.keeperReason})`)
        : h('span', { class: 'score', title: 'Similarity to the suggested keeper' }, `${formatScore(member.score)} similar`),
      e.exactOnly && e.status !== 'ok' ? h('span', { class: 'badge', title: e.reason, text: 'Exact copy only' }) : null,
    );
    const choose = (wanted) => () => {
      if (session.decision(group, member.index) !== wanted) {
        session.toggle(group, member.index);
        refreshCard(g);
        announce(`Photo ${n + 1} marked to ${wanted}.`);
      }
    };
    tiles.append(
      h('div', { class: `tile ${decision}` },
        thumb,
        h('div', {}, head, describeEntry(member.index)),
        h('div', { class: 'decision', role: 'group', 'aria-label': `Decision for photo ${n + 1}` },
          h('button', { type: 'button', class: 'button keep-button', 'data-focus-key': `keep-${n}`, 'aria-pressed': String(decision === 'keep'), onclick: choose('keep') }, icon('keep'), 'Keep'),
          h('button', { type: 'button', class: 'button remove-button', 'data-focus-key': `remove-${n}`, 'aria-pressed': String(decision === 'remove'), onclick: choose('remove') }, icon('remove'), 'Remove'),
        ),
      ),
    );
  });
  card.append(tiles);
  return card;
}

function renderSkipped() {
  const skipped = state.entries.filter((e) => e.status === 'skipped' || e.status === 'failed');
  ui.skipped.hidden = skipped.length === 0;
  ui.skippedSummary.textContent = `Skipped files (${skipped.length.toLocaleString('en')}) — not analysed for similarity`;
  ui.skippedList.replaceChildren(
    ...skipped.slice(0, 2000).map((e) => h('li', {}, h('strong', { text: e.path }), ` — ${e.reason || 'Unknown reason.'}`)),
    skipped.length > 2000 ? h('li', { text: `… and ${skipped.length - 2000} more (all of them are listed in the JSON export).` }) : null,
  );
}

// ---------------------------------------------------------------------------
// Review actions

function groupAt(g) {
  return state.session.groups[g];
}

function accept(g, advance = false) {
  state.session.accept(groupAt(g));
  refreshCard(g);
  announce(`Group ${g + 1} reviewed.`);
  if (advance) focusGroup(g + 1);
}

function keepAll(g) {
  state.session.keepAll(groupAt(g));
  refreshCard(g);
  announce(`Group ${g + 1}: all photos kept.`);
}

function resetGroup(g) {
  state.session.resetGroup(groupAt(g));
  refreshCard(g);
  announce(`Group ${g + 1} reset to the suggestion.`);
}

function focusGroup(g) {
  const groups = state.session.groups;
  if (!groups.length) return;
  const target = Math.max(0, Math.min(groups.length - 1, g));
  if (target >= state.rendered) renderMore(target);
  const previous = ui.groups.querySelector('.group.current');
  if (previous) previous.classList.remove('current');
  state.current = target;
  const card = ui.groups.querySelector(`[data-group="${target}"]`);
  if (card) {
    card.classList.add('current');
    card.focus({ preventScroll: true });
    card.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
}

function setThreshold(value) {
  const t = Math.max(MIN_SCORE, Math.min(100, value));
  state.session.setThreshold(t);
  state.current = -1;
  renderThreshold();
  renderSummary();
  renderGroups();
}

// ---------------------------------------------------------------------------
// Compare

let compareView = null;

function openCompare(g, rightIndex) {
  const group = groupAt(g);
  if (!compareView) {
    compareView = new CompareView({
      dialog: ui.compareDialog,
      urlFor,
      fileFor: (i) => state.entries[i].file,
      describe: describeEntry,
      decisionOf: (grp, i) => state.session.decision(grp, i),
      scoreOf: (a, b) => state.session.score(a, b),
      onDecision: (grp, i, wanted) => {
        if (state.session.decision(grp, i) !== wanted) {
          state.session.toggle(grp, i);
          const index = state.session.groups.indexOf(grp);
          if (index >= 0) refreshCard(index);
        }
      },
    });
  }
  state.current = g;
  compareView.open(group, rightIndex);
}

// ---------------------------------------------------------------------------
// Export

function openExport() {
  const session = state.session;
  const report = session.report({ version: APP_VERSION, createdAt: new Date().toISOString(), formatLabel });
  const s = session.summary();
  const paths = pathsToRemove(report);
  const location = describeRunLocation(state.entries.map((e) => e.path));
  const scriptOptions = { version: APP_VERSION, createdAt: report.createdAt, runLocation: location.text };
  const stamp = report.createdAt.slice(0, 10);

  const body = ui.exportBody;
  body.replaceChildren(
    h('p', {}, `${plural(s.groups, 'group')}, ${plural(s.toRemove, 'file')} marked for removal (${formatBytes(s.bytes)}). DupeLens itself does not write to your files. When you run a move script with the apply flag, it moves the marked files into a folder called `, h('code', { text: DEFAULT_REVIEW_FOLDER }), ' next to them, keeping their relative paths. Review the script before running it and keep a backup of your photos.'),
    s.reviewed < s.groups ? h('p', { class: 'callout warning' }, icon('warning'), ` ${plural(s.groups - s.reviewed, 'group')} still use${s.groups - s.reviewed === 1 ? 's' : ''} the automatic suggestion. Their decisions are exported as they are shown.`) : null,
    s.allRemoved ? h('p', { class: 'callout warning' }, icon('warning'), ` In ${plural(s.allRemoved, 'group')} every copy is marked for removal.`) : null,
    h('h3', { text: 'Decisions' }),
    h('div', { class: 'export-grid' },
      h('button', { type: 'button', class: 'button', onclick: () => downloadText(`dupelens-decisions-${stamp}.json`, reportToJson(report), 'application/json') }, icon('download'), 'Decisions as JSON'),
      h('button', { type: 'button', class: 'button', onclick: () => downloadText(`dupelens-decisions-${stamp}.csv`, reportToCsv(report), 'text/csv') }, icon('download'), 'Decisions as CSV'),
    ),
    h('h3', { text: 'Move scripts (dry run by default)' }),
    h('p', { class: 'callout' }, h('strong', { text: 'Where to run them: ' }), location.text),
    h('div', { class: 'export-grid' },
      h('button', { type: 'button', class: 'button', disabled: paths.length === 0, onclick: () => downloadText('dupelens-move.ps1', '﻿' + powerShellScript(paths, scriptOptions), 'text/plain') }, icon('download'), 'PowerShell (Windows)'),
      h('button', { type: 'button', class: 'button', disabled: paths.length === 0, onclick: () => downloadText('dupelens-move.sh', shellScript(paths, scriptOptions), 'text/x-shellscript') }, icon('download'), 'Shell script (macOS, Linux)'),
    ),
    h('p', { class: 'muted' }, 'Windows: ', h('code', { text: 'powershell -ExecutionPolicy Bypass -File .\\dupelens-move.ps1' }), ' shows what would happen; add ', h('code', { text: '-Apply' }), ' to move. macOS/Linux: ', h('code', { text: 'sh dupelens-move.sh' }), ', then ', h('code', { text: 'sh dupelens-move.sh --apply' }), '.'),
  );
  ui.exportDialog.showModal();
}

// ---------------------------------------------------------------------------
// Events

function wireEvents() {
  ui.folderButton.addEventListener('click', () => ui.folderInput.click());
  ui.fileButton.addEventListener('click', () => ui.fileInput.click());
  ui.addButton.addEventListener('click', () => ui.addInput.click());
  for (const input of [ui.folderInput, ui.fileInput, ui.addInput]) {
    input.addEventListener('change', () => {
      const files = filesFromInput(input.files || []);
      input.value = '';
      addFiles(files);
    });
  }

  // Drag and drop anywhere on the page.
  let depth = 0;
  document.addEventListener('dragenter', (event) => {
    if (!event.dataTransfer || !Array.from(event.dataTransfer.types).includes('Files')) return;
    depth++;
    document.body.classList.add('dragging');
  });
  document.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (!depth) document.body.classList.remove('dragging');
  });
  document.addEventListener('dragover', (event) => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = state.busy ? 'none' : 'copy';
  });
  document.addEventListener('drop', async (event) => {
    event.preventDefault();
    depth = 0;
    document.body.classList.remove('dragging');
    if (state.busy || !event.dataTransfer) return;
    const files = await filesFromDrop(event.dataTransfer);
    addFiles(files);
  });

  ui.cancelButton.addEventListener('click', () => {
    state.cancel.cancelled = true;
    ui.progressText.textContent = 'Stopping after the files in progress…';
  });

  ui.threshold.addEventListener('input', () => setThreshold(Number(ui.threshold.value)));
  for (const chip of document.querySelectorAll('[data-preset]')) {
    chip.addEventListener('click', () => {
      setThreshold(Number(chip.getAttribute('data-preset')));
      announce(`Threshold ${formatScore(state.session.threshold)}: ${plural(state.session.groups.length, 'group')}.`);
    });
  }
  for (const [value, label] of Object.entries(SORT_ORDERS)) ui.sortOrder.append(h('option', { value, text: label }));
  ui.sortOrder.addEventListener('change', () => {
    state.session.setSortOrder(ui.sortOrder.value);
    state.current = -1;
    renderGroups();
  });

  ui.exportButton.addEventListener('click', openExport);
  ui.restartButton.addEventListener('click', () => {
    if (state.busy) return;
    if (state.session && state.session.summary().reviewed > 0 && !confirm('Start over? Your decisions will be lost (files are not touched).')) return;
    releaseUrls();
    state.entries = [];
    state.seen.clear();
    state.session = null;
    state.current = -1;
    showView('start');
    ui.folderButton.focus();
  });
  ui.helpButton.addEventListener('click', () => ui.helpDialog.showModal());
  for (const dialog of [ui.exportDialog, ui.helpDialog]) {
    dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
  }

  // Load more cards when the end of the list comes into view.
  if ('IntersectionObserver' in globalThis) {
    const observer = new IntersectionObserver((records) => {
      if (records.some((r) => r.isIntersecting) && state.session && state.rendered < state.session.groups.length) renderMore();
    }, { rootMargin: '800px' });
    observer.observe(ui.groupsSentinel);
  } else {
    window.addEventListener('scroll', () => {
      if (state.session && window.innerHeight + window.scrollY > document.body.offsetHeight - 1200) renderMore();
    });
  }

  document.addEventListener('keydown', onKeyDown);
}

function onKeyDown(event) {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
  if (document.querySelector('dialog[open]')) return; // dialogs handle their own keys
  if (event.key === '?') {
    ui.helpDialog.showModal();
    event.preventDefault();
    return;
  }
  if (!state.session || ui.reviewView.hidden || isTypingTarget(event.target)) return;
  const onRange = event.target instanceof HTMLInputElement && event.target.type === 'range';
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  // Shortcuts act on the group that contains the keyboard focus, if any.
  const focusedCard = event.target instanceof Element ? event.target.closest('.group') : null;
  if (focusedCard) state.current = Number(focusedCard.getAttribute('data-group'));
  const g = state.current;
  const has = g >= 0 && g < state.session.groups.length;
  if (key === 'j' || (key === 'ArrowDown' && !onRange)) focusGroup(g + 1);
  else if (key === 'k' || (key === 'ArrowUp' && !onRange)) focusGroup(g < 0 ? 0 : g - 1);
  else if (key === 't') ui.threshold.focus();
  else if (key === 'e') openExport();
  else if (has && (key === 'a' || (key === 'Enter' && event.target === document.querySelector('.group.current')))) accept(g, true);
  else if (has && key === 'n') keepAll(g);
  else if (has && key === 'u') resetGroup(g);
  else if (has && key === 'c') openCompare(g);
  else if (has && /^[1-9]$/.test(key)) {
    const group = groupAt(g);
    const n = Number(key) - 1;
    if (n >= group.members.length) return;
    state.session.toggle(group, group.members[n].index);
    refreshCard(g);
    announce(`Photo ${n + 1} marked to ${state.session.decision(group, group.members[n].index)}.`);
  } else return;
  event.preventDefault();
}

// ---------------------------------------------------------------------------

function init() {
  cacheElements();
  hydrateIcons();
  initTheme();
  ui.appVersion.textContent = `v${APP_VERSION}`;
  ui.threshold.min = String(MIN_SCORE);
  ui.engineMode.textContent = 'Analysis engine ready';
  wireEvents();
  showView('start');
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
