import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// WCAG 2.2 contrast of the colour tokens in src/app/styles.css, in the light
// and the dark theme: 4.5:1 for text (1.4.3), 3:1 for focus indicators,
// control borders and other meaningful non-text graphics (1.4.11).

const css = await readFile(new URL('../src/app/styles.css', import.meta.url), 'utf8');

/** Custom properties of the first rule whose selector matches. */
function tokens(selector) {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `rule ${selector}`);
  const body = css.slice(start, css.indexOf('}', start));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map((m) => [m[1], m[2].toLowerCase()]));
}

const light = tokens(':root');
const dark = { ...light, ...tokens(":root[data-theme='dark']") };

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** [foreground, background, minimum ratio, where it is used] */
const PAIRS = [
  ['text', 'bg', 4.5, 'body text'],
  ['text', 'surface', 4.5, 'text on cards and dialogs'],
  ['text', 'surface-2', 4.5, 'text on secondary surfaces'],
  ['muted', 'bg', 4.5, 'hints on the page background'],
  ['muted', 'surface', 4.5, 'hints on cards'],
  ['muted', 'surface-2', 4.5, 'badges'],
  ['muted', 'remove-soft', 4.5, 'facts of a photo marked Remove'],
  ['text', 'remove-soft', 4.5, 'text of a photo marked Remove'],
  ['accent', 'surface', 4.5, 'links and the similarity value'],
  ['accent', 'bg', 4.5, 'links on the page background'],
  ['accent-text', 'accent', 4.5, 'primary buttons and the current step'],
  ['accent', 'accent-soft', 4.5, 'step numbers and badges'],
  ['text', 'accent-soft', 4.5, 'selected presets'],
  ['keep', 'keep-soft', 4.5, 'Reviewed and Suggested keeper badges'],
  ['keep', 'surface', 4.5, 'completed steps'],
  ['surface', 'keep', 4.5, 'pressed Keep button'],
  ['surface', 'remove', 4.5, 'pressed Remove button'],
  ['warn', 'warn-soft', 4.5, 'warning badges'],
  ['text', 'warn-soft', 4.5, 'warning callouts'],
  ['focus', 'bg', 3, 'focus indicator on the page'],
  ['focus', 'surface', 3, 'focus indicator on cards'],
  ['control-border', 'surface', 3, 'borders of buttons and fields'],
  ['control-border', 'bg', 3, 'borders of buttons on the page background'],
  ['keep', 'surface', 3, 'border of a photo marked Keep'],
  ['remove', 'remove-soft', 3, 'border of a photo marked Remove'],
  ['muted', 'surface', 3, 'outline of the step numbers'],
];

for (const [name, theme] of [['light', light], ['dark', dark]]) {
  test(`colour contrast meets WCAG 2.2 AA in the ${name} theme`, () => {
    const failures = [];
    for (const [fg, bg, min, use] of PAIRS) {
      assert.ok(theme[fg] && theme[bg], `tokens --${fg} and --${bg} exist`);
      const ratio = contrast(theme[fg], theme[bg]);
      if (ratio < min) failures.push(`${use}: --${fg} ${theme[fg]} on --${bg} ${theme[bg]} is ${ratio.toFixed(2)}:1, needs ${min}:1`);
    }
    assert.deepEqual(failures, []);
  });
}

test('the dark theme for the system setting uses the same colours as the explicit dark theme', () => {
  const system = tokens("  :root:not([data-theme='light'])");
  for (const [key, value] of Object.entries(system)) assert.equal(value, dark[key], `--${key}`);
});
