#!/usr/bin/env node
// Automated smoke test of the single-file build in a headless Chromium-based
// browser (Chrome, Edge or Chromium), driven over the DevTools protocol
// (tools/lib/browser.mjs) — no dependencies, a throw-away browser profile,
// only synthetic photos (the sample photos and examples/).
//
//   npm run build && node tools/smoke-browser.mjs
//   node tools/smoke-browser.mjs --url <address>                # local development server
//   node tools/smoke-browser.mjs --no-workers                   # main-thread fallback
//   node tools/smoke-browser.mjs --screenshot out.png [--dark]   # start and review screens
//   BROWSER=/path/to/chrome node tools/smoke-browser.mjs
//
// Checks: the page loads without errors or network requests, the start
// screen shows the three steps and the "as is" note, "Try with sample photos"
// draws the demo set and finds its groups, the folder picker accepts
// examples/, the analysis finishes (and reports whether workers or the
// main-thread fallback were used), the expected groups appear, the threshold
// presets and the keyboard shortcuts work, the compare modes render, the four
// exports download — the sh script is then run on a temporary copy of
// examples/ (dry run, then apply) — and a folder without duplicates shows the
// empty state. Accessibility: the start screen is operated with Tab and Enter
// only, the focus is visible, every control has an accessible name and
// regrouping is announced.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, readdir, writeFile, access, cp } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { launchBrowser, waitFor } from './lib/browser.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const run = promisify(execFile);
const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

async function main() {
  const base = option('--url') || pathToFileURL(path.join(ROOT, 'dist', 'dupelens.html')).href;
  const target = args.includes('--no-workers') ? `${base}${base.includes('?') ? '&' : '?'}workers=0` : base;
  const results = [];
  const check = (ok, label, detail = '') => {
    results.push({ ok, label, detail });
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  };

  const page = await launchBrowser({ width: 1400, height: 1000 });
  const { send, evaluate, profile } = page;
  try {
    const problems = [];
    const requests = [];
    page.onEvent((message) => {
      if (message.method === 'Runtime.exceptionThrown') problems.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
      if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') problems.push(message.params.args.map((a) => a.value ?? a.description).join(' '));
      if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') problems.push(message.params.entry.text);
      if (message.method === 'Network.requestWillBeSent') requests.push(message.params.request.url);
    });
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Log.enable');
    await send('Network.enable');
    if (args.includes('--dark')) {
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
    }
    const screenshot = option('--screenshot');
    const capture = async (file) => {
      const { data } = await send('Page.captureScreenshot', { format: 'png' });
      await writeFile(file, Buffer.from(data, 'base64'));
      console.log(`     screenshot written to ${file}`);
    };

    await send('Page.navigate', { url: target });
    await waitFor(() => evaluate("document.readyState === 'complete' && !!document.getElementById('app-version').textContent"), 20000, 'the page to load');
    check(true, 'page loaded', target.startsWith('file:') ? 'file://' : target);
    check(/^v\d+\.\d+\.\d+/.test(await evaluate("document.getElementById('app-version').textContent")), 'version shown in the footer', await evaluate("document.getElementById('app-version').textContent"));

    if (screenshot) await capture(screenshot.replace(/\.png$/i, '') + '-start.png');
    const currentStep = "(document.querySelector('#steps [aria-current=\"step\"]') || {}).textContent?.trim()";
    const start = await evaluate(`({
      step: ${currentStep},
      steps: [...document.querySelectorAll('#steps [data-step]')].map((s) => s.textContent.trim()),
      note: document.getElementById('disclaimer').textContent,
      sample: document.getElementById('sample-button').textContent.trim(),
    })`);
    check(start.steps.length === 3 && start.step === '1 Choose photos' && /as is/.test(start.note) && /without warranty/.test(start.note) && /sample photos/.test(start.sample),
      'start screen shows the three steps, the "as is" note and the sample button', `${start.steps.join(' → ')}; current: ${start.step}`);

    // Keyboard only: Tab from the top of the page reaches the controls in a
    // logical order with a visible focus indicator; Enter starts the demo.
    const key = async (name, code, keyCode, text) => {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code, windowsVirtualKeyCode: keyCode, text });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code, windowsVirtualKeyCode: keyCode });
    };
    await evaluate("document.activeElement && document.activeElement.blur(), true");
    const order = [];
    let focusStyle = null;
    for (let i = 0; i < 6; i++) {
      await key('Tab', 'Tab', 9);
      const focused = await evaluate(`(() => {
        const el = document.activeElement;
        const style = getComputedStyle(el);
        return { name: el.id || el.className, outline: style.outlineStyle + ' ' + style.outlineWidth };
      })()`);
      order.push(focused.name);
      if (focused.name === 'sample-button') focusStyle = focused.outline;
    }
    const expectedOrder = ['skip-link', 'theme-toggle', 'help-button', 'folder-button', 'file-button', 'sample-button'];
    check(order.join() === expectedOrder.join() && /^solid [3-9]/.test(focusStyle || ''),
      'keyboard: Tab order on the start screen with a visible focus indicator', `${order.join(' → ')}; focus ${focusStyle}`);

    // "Try with sample photos" with Enter: the demo set is drawn in the browser and analysed.
    await key('Enter', 'Enter', 13, '\r');
    await waitFor(() => evaluate("!document.getElementById('review-view').hidden"), 90000, 'the review of the sample photos');
    const demo = await evaluate(`({
      step: ${currentStep},
      groups: [...document.querySelectorAll('.group')].map((g) => [...g.querySelectorAll('.facts dd[title]')].map((d) => d.title).sort()),
    })`);
    const demoBeach = demo.groups.find((g) => g.includes('sample-photos/holiday/beach-sunset.png'));
    check(demo.groups.length === 5 && Boolean(demoBeach && demoBeach.length === 4) && demo.step === '2 Review groups',
      'sample photos: five groups at 90 % and step 2 is current', `${demo.groups.length} groups; current: ${demo.step}`);
    const names = await evaluate(`(() => {
      const nameOf = (el) => (el.getAttribute('aria-label') || (el.labels && el.labels[0] ? el.labels[0].textContent : '') || el.textContent).trim();
      const controls = [...document.querySelectorAll('button, input, select')].filter((el) => el.type !== 'file' && !el.closest('[hidden]') && !el.closest('dialog:not([open])'));
      const cards = [...document.querySelectorAll('.group')];
      return {
        controls: controls.length,
        unnamed: controls.filter((el) => !nameOf(el)).map((el) => el.outerHTML.slice(0, 80)),
        cards: cards.length,
        unlabelledCards: cards.filter((c) => !(document.getElementById(c.getAttribute('aria-labelledby')) || {}).textContent).length,
      };
    })()`);
    check(names.controls > 20 && names.unnamed.length === 0 && names.cards > 0 && names.unlabelledCards === 0,
      'every control and every group card has an accessible name', `${names.controls} controls, ${names.cards} cards${names.unnamed.length ? `; unnamed: ${names.unnamed.join(' | ')}` : ''}`);
    const announced = await evaluate(`(async () => {
      document.querySelector('[data-preset="100"]').click();
      await new Promise((r) => setTimeout(r, 150));
      const text = document.getElementById('announcer').textContent;
      document.querySelector('[data-preset="90"]').click();
      return text;
    })()`);
    check(/^Similarity 100 %: 1 group\.$/.test(announced), 'regrouping is announced to screen readers', announced);
    await evaluate("document.getElementById('restart-button').click(), true");
    check(await evaluate("!document.getElementById('start-view').hidden"), 'start over returns to step 1');

    // Drag and drop is not simulated reliably in headless mode; it is part
    // of the manual smoke test in docs/RELEASING.md.
    const { root } = await send('DOM.getDocument', { depth: 1 });
    const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: '#folder-input' });
    await send('DOM.setFileInputFiles', { nodeId, files: [path.join(ROOT, 'examples')] });

    await waitFor(() => evaluate("!document.getElementById('review-view').hidden"), 90000, 'the review view');
    const info = await evaluate(`({
      mode: document.getElementById('engine-mode').textContent,
      groups: [...document.querySelectorAll('.group')].map((g) => [...g.querySelectorAll('.facts dd[title]')].map((d) => d.title).sort()),
      summary: document.getElementById('summary').textContent,
      skipped: document.getElementById('skipped-summary').textContent,
    })`);
    check(true, 'analysis finished', info.mode);
    check(info.groups.length === 5, 'five groups at the default threshold of 90 %', `${info.groups.length} groups`);
    const beach = info.groups.find((g) => g.some((p) => p.endsWith('holiday/beach-sunset.png')));
    check(Boolean(beach && beach.length === 4), 'beach group has the original, the small and brighter copies and the byte-identical copy', beach ? beach.join(', ') : 'missing');
    check(!info.groups.some((g) => g.some((p) => p.includes('forest-rotated'))), 'rotated copy is not grouped (documented limitation)');
    check(/Skipped files \(2\)/.test(info.skipped), 'README.md and misc/notes.txt are listed as skipped', info.skipped);

    const exact = await evaluate(`(() => {
      const preset = document.querySelector('[data-preset="100"]');
      preset.click();
      return document.querySelectorAll('.group').length;
    })()`);
    check(exact === 1, 'the "Exact" preset regroups instantly', `${exact} group(s) at 100 %`);
    await evaluate(`document.querySelector('[data-preset="90"]').click()`);

    const toggled = await evaluate(`(() => {
      const card = document.querySelector('.group');
      const before = card.querySelectorAll('.tile.remove').length;
      card.querySelector('.tile .keep-button:not([aria-pressed="true"])').click();
      const after = document.querySelector('.group').querySelectorAll('.tile.remove').length;
      return [before, after];
    })()`);
    check(toggled[1] === toggled[0] - 1, 'keep/remove toggle updates the card', `${toggled[0]} → ${toggled[1]} marked for removal`);

    // Keyboard: J selects the next group, 2 toggles its second photo, A accepts and moves on.
    const press = async (key) => {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key, text: key });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key });
    };
    await evaluate("document.activeElement && document.activeElement.blur(), document.body.focus(), true");
    await press('j');
    await press('j');
    const beforeKeys = await evaluate("[...document.querySelectorAll('.group')][1].querySelectorAll('.tile.remove').length");
    await press('2');
    await press('a');
    const keys = await evaluate(`(() => {
      const cards = [...document.querySelectorAll('.group')];
      return {
        removed: cards[1].querySelectorAll('.tile.remove').length,
        status: cards[1].querySelector('.badge').textContent,
        current: cards.findIndex((c) => c.classList.contains('current')),
      };
    })()`);
    check(keys.removed !== beforeKeys && keys.status.includes('Reviewed') && keys.current === 2, 'keyboard shortcuts J, 2 and A work', `removed ${beforeKeys} → ${keys.removed}, ${keys.status}, current group ${keys.current + 1}`);

    const dialogs = await evaluate(`(async () => {
      document.getElementById('export-button').click();
      const exportOpen = document.getElementById('export-dialog').open;
      const exportStep = ${currentStep};
      const buttons = [...document.querySelectorAll('#export-body button')].map((b) => b.textContent.trim());
      document.getElementById('export-dialog').close();
      await new Promise((r) => setTimeout(r, 100));
      const afterStep = ${currentStep};
      document.querySelector('.group .group-actions button').click();
      await new Promise((r) => setTimeout(r, 300));
      const compareOpen = document.getElementById('compare-dialog').open;
      const modes = [];
      for (const mode of ['slider', 'flicker', 'difference', 'side']) {
        document.querySelector('[data-mode="' + mode + '"]').click();
        await new Promise((r) => setTimeout(r, mode === 'difference' ? 1500 : 200));
        modes.push(mode + ':' + document.getElementById('compare-stage').children.length + ':' + (document.querySelector('#compare-stage canvas') ? 'canvas' : ''));
      }
      document.getElementById('compare-dialog').close();
      return { exportOpen, exportStep, afterStep, buttons, compareOpen, modes };
    })()`);
    check(dialogs.exportOpen && dialogs.buttons.length === 4, 'export dialog offers JSON, CSV, PowerShell and sh', dialogs.buttons.join(' | '));
    check(dialogs.exportStep === '3 Export' && dialogs.afterStep === '2 Review groups', 'the export dialog is step 3, closing it returns to step 2');
    check(dialogs.compareOpen, 'compare view opens', dialogs.modes.join(' '));
    check(dialogs.modes.some((m) => m.startsWith('difference') && m.endsWith('canvas')), 'difference mode renders a canvas');

    // Downloads: all four exports, then run the sh script on a copy of examples/.
    const downloads = path.join(profile, 'downloads');
    await mkdir(downloads, { recursive: true });
    await page.sendBrowser('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
    const expectedRemovals = await evaluate(`(async () => {
      document.getElementById('export-button').click();
      for (const button of document.querySelectorAll('#export-body button')) {
        button.click();
        await new Promise((r) => setTimeout(r, 300));
      }
      document.getElementById('export-dialog').close();
      return [...document.querySelectorAll('.tile.remove')].length;
    })()`);
    const files = await waitFor(async () => {
      const names = await readdir(downloads).catch(() => []);
      return names.filter((n) => !n.endsWith('.crdownload')).length >= 4 ? names : null;
    }, 15000, 'the downloads');
    const json = JSON.parse(await readFile(path.join(downloads, files.find((n) => n.endsWith('.json'))), 'utf8'));
    const csv = await readFile(path.join(downloads, files.find((n) => n.endsWith('.csv'))), 'utf8');
    const ps1 = await readFile(path.join(downloads, 'dupelens-move.ps1'));
    check(json.summary.filesToRemove === expectedRemovals && csv.startsWith('group,group_status,decision'), 'JSON and CSV exports match the review', `${json.summary.filesToRemove} files to remove, ${json.groups.length} groups`);
    check(ps1[0] === 0xef && ps1[1] === 0xbb && ps1[2] === 0xbf, 'PowerShell script is saved with a UTF-8 byte order mark');
    const shell = process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\sh.exe' : '/bin/sh';
    if (await access(shell).then(() => true, () => false)) {
      const work = path.join(profile, 'work');
      await cp(path.join(ROOT, 'examples'), path.join(work, 'examples'), { recursive: true });
      const script = path.join(downloads, 'dupelens-move.sh');
      const dry = await run(shell, [script, '--root', work]);
      const applied = await run(shell, [script, '--root', work, '--apply']);
      const moved = (await readdir(path.join(work, '_dupelens_review'), { recursive: true }).catch(() => [])).filter((n) => /\.(png|txt)$/.test(n)).length;
      check(dry.stdout.includes(`Dry run: ${expectedRemovals} file(s) would be moved`) && moved === expectedRemovals, 'downloaded sh script: dry run first, then moves the marked files into _dupelens_review/', `${moved} moved; ${applied.stdout.trim().split('\n').pop()}`);
    }
    if (process.platform === 'win32') {
      const work = path.join(profile, 'work-ps');
      await cp(path.join(ROOT, 'examples'), path.join(work, 'examples'), { recursive: true });
      const psArgs = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(downloads, 'dupelens-move.ps1'), '-Root', work];
      const dry = await run('powershell.exe', psArgs);
      const applied = await run('powershell.exe', [...psArgs, '-Apply']);
      const moved = (await readdir(path.join(work, '_dupelens_review'), { recursive: true }).catch(() => [])).filter((n) => /\.(png|txt)$/.test(n)).length;
      check(dry.stdout.includes(`Dry run: ${expectedRemovals} file(s) would be moved`) && moved === expectedRemovals, 'downloaded PowerShell script: dry run first, then moves the marked files', `${moved} moved; ${applied.stdout.trim().split('\n').pop()}`);
    }

    if (screenshot) {
      await evaluate('window.scrollTo(0, 0)');
      await capture(screenshot);
      await evaluate(`(async () => {
        document.querySelector('.group .group-actions button').click();
        document.querySelector('[data-mode="slider"]').click();
        await new Promise((r) => setTimeout(r, 500));
      })()`);
      await capture(screenshot.replace(/\.png$/i, '') + '-compare.png');
      await evaluate("document.getElementById('compare-dialog').close()");
    }

    // A folder without duplicates shows the empty state with a way forward.
    await evaluate("window.confirm = () => true; document.getElementById('restart-button').click(), true");
    await send('DOM.setFileInputFiles', { nodeId, files: [path.join(ROOT, 'examples', 'misc')] });
    await waitFor(() => evaluate("!document.getElementById('review-view').hidden && !!document.querySelector('#groups .empty')"), 60000, 'the empty state');
    const empty = await evaluate(`(() => {
      const box = document.querySelector('#groups .empty');
      const lower = box.querySelector('[data-action="lower"]');
      const text = box.textContent;
      if (lower) lower.click();
      return { text, lower: lower ? lower.textContent : '', threshold: document.getElementById('threshold-value').textContent };
    })()`);
    check(/No duplicates at 90/.test(empty.text) && /similar shots/i.test(empty.lower) && empty.threshold === '80 %',
      'a folder without duplicates shows the empty state, which offers a lower similarity', `${empty.lower} → ${empty.threshold}`);

    const external = requests.filter((url) => !/^(data|blob|file|about|chrome|devtools):/.test(url) && !(option('--url') && url.startsWith(option('--url'))));
    check(external.length === 0, 'no network requests', external.join(', '));
    check(problems.length === 0, 'no console errors or exceptions', problems.join(' | '));
  } finally {
    await page.close();
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
