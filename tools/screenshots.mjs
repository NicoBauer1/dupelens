#!/usr/bin/env node
// Takes the README screenshots of the single-file build in a headless
// Chromium-based browser, using only the sample photos that DupeLens draws
// itself. Only the page is captured (no browser frame), and the PNG files in
// docs/images/ keep nothing but the image data.
//
//   npm run build && node tools/screenshots.mjs
//   node tools/screenshots.mjs --out some/dir

import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { launchBrowser, waitFor, sleep } from './lib/browser.mjs';
import { stripPngMetadata } from './lib/png.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const outDir = args.includes('--out') ? path.resolve(args[args.indexOf('--out') + 1]) : path.join(ROOT, 'docs', 'images');
const WIDTH = 1200;
const HEIGHT = 760;
const START_HEIGHT = 860; // the start screen including the "as is" note and the footer

async function main() {
  const page = await launchBrowser({ width: WIDTH, height: HEIGHT });
  try {
    const { send, evaluate } = page;
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });
    await mkdir(outDir, { recursive: true });
    const size = (height) => send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height, deviceScaleFactor: 1, mobile: false });
    const capture = async (name) => {
      const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      const file = path.join(outDir, name);
      // Keep only the image data: no text, time or colour-profile chunks.
      const png = stripPngMetadata(new Uint8Array(Buffer.from(data, 'base64')));
      await writeFile(file, png);
      console.log(`wrote ${path.relative(ROOT, file)} (${Math.round(png.length / 1024)} KiB)`);
    };
    const load = async (scheme) => {
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
      await send('Page.navigate', { url: pathToFileURL(path.join(ROOT, 'dist', 'dupelens.html')).href });
      await waitFor(() => evaluate("document.readyState === 'complete' && !!document.getElementById('app-version').textContent"), 20000, 'the page to load');
      // Hide the text cursor and the hover state of the last click.
      await evaluate("document.activeElement && document.activeElement.blur(), true");
    };
    const samples = async () => {
      await evaluate("document.getElementById('sample-button').click(), true");
      await waitFor(() => evaluate("!document.getElementById('review-view').hidden"), 90000, 'the review view');
      await waitFor(() => evaluate("[...document.querySelectorAll('.group img')].slice(0, 4).every((img) => img.complete && img.naturalWidth > 0)"), 20000, 'the thumbnails');
      await evaluate("document.activeElement && document.activeElement.blur(), window.scrollTo(0, 0), true");
      await sleep(300);
    };

    // 1. Start screen, light theme.
    await size(START_HEIGHT);
    await load('light');
    await capture('start.png');

    // 2. Step 2 with the sample photos, light theme.
    await size(HEIGHT);
    await samples();
    await capture('review.png');

    // 3. Compare view (slider) in the dark theme.
    await load('dark');
    await samples();
    await evaluate(`(async () => {
      // The brighter copy of the beach photo against the suggested keeper.
      const card = [...document.querySelectorAll('.group')].find((g) => g.textContent.includes('beach-sunset-brighter'));
      const tile = [...card.querySelectorAll('.tile')].find((t) => t.textContent.includes('beach-sunset-brighter'));
      tile.querySelector('.thumb').click();
      await new Promise((r) => setTimeout(r, 200));
      document.querySelector('[data-mode="slider"]').click();
      await new Promise((r) => setTimeout(r, 400));
      document.activeElement && document.activeElement.blur();
    })()`);
    await sleep(300);
    await capture('compare-dark.png');
  } finally {
    await page.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
