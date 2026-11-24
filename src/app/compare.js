// Compare view: two photos of a group side by side, with a slider, flicker or
// pixel difference mode.

import { h } from './dom.js';
import { icon } from './icons.js';
import { formatScore } from './format.js';

export const COMPARE_MODES = ['side', 'slider', 'flicker', 'difference'];

const FLICKER_MS = 700;
const DIFFERENCE_WIDTH = 1200;

export class CompareView {
  /**
   * @param {object} options
   * @param {HTMLDialogElement} options.dialog
   * @param {(index: number) => string | null} options.urlFor object URL of an entry
   * @param {(index: number) => File | null} options.fileFor
   * @param {(index: number) => Node} options.describe facts of an entry
   * @param {(group: any, index: number, decision: 'keep' | 'remove') => void} options.onDecision
   * @param {(group: any, index: number) => 'keep' | 'remove'} options.decisionOf
   * @param {(a: number, b: number) => number} options.scoreOf
   */
  constructor(options) {
    Object.assign(this, options);
    this.stage = this.dialog.querySelector('#compare-stage');
    this.controls = this.dialog.querySelector('#compare-controls');
    this.mode = 'side';
    this.group = null;
    this.left = -1;
    this.right = -1;
    this.timer = 0;
    this.split = 50;
    this.showRight = true;
    this.renderToken = 0;
    for (const button of this.dialog.querySelectorAll('[data-mode]')) {
      button.addEventListener('click', () => this.setMode(button.getAttribute('data-mode')));
    }
    this.dialog.querySelector('[data-close]').addEventListener('click', () => this.dialog.close());
    this.dialog.addEventListener('close', () => this.stop());
    this.dialog.addEventListener('keydown', (event) => this.onKey(event));
    this.dialog.addEventListener('click', (event) => {
      if (event.target === this.dialog) this.dialog.close();
    });
  }

  /**
   * @param {any} group
   * @param {number} [rightIndex] entry index for the right side
   */
  open(group, rightIndex) {
    this.group = group;
    this.left = group.keeperIndex;
    const others = group.members.map((m) => m.index).filter((i) => i !== this.left);
    this.right = rightIndex !== undefined && rightIndex !== this.left ? rightIndex : others[0];
    this.render();
    if (!this.dialog.open) this.dialog.showModal();
  }

  get isOpen() {
    return this.dialog.open;
  }

  /** @param {string} mode */
  setMode(mode) {
    if (!COMPARE_MODES.includes(mode)) return;
    this.mode = mode;
    this.render();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = 0;
    this.renderToken++;
  }

  /** @param {number} step +1 or -1 */
  stepRight(step) {
    const indices = this.group.members.map((m) => m.index).filter((i) => i !== this.left);
    const at = indices.indexOf(this.right);
    this.right = indices[(at + step + indices.length) % indices.length];
    this.render();
  }

  onKey(event) {
    if (event.target instanceof HTMLSelectElement || event.target instanceof HTMLInputElement) {
      if (event.key !== 'Escape') return;
    }
    const key = event.key.toLowerCase();
    if (event.key === 'ArrowRight') this.stepRight(1);
    else if (event.key === 'ArrowLeft') this.stepRight(-1);
    else if (key === 'm') this.setMode(COMPARE_MODES[(COMPARE_MODES.indexOf(this.mode) + 1) % COMPARE_MODES.length]);
    else if (key === 'k') this.decide(this.right, 'keep');
    else if (key === 'r') this.decide(this.right, 'remove');
    else if (event.key === ' ' && this.mode === 'flicker') this.flip();
    else return;
    event.preventDefault();
  }

  decide(index, decision) {
    this.onDecision(this.group, index, decision);
    this.renderControls();
  }

  flip() {
    this.showRight = !this.showRight;
    const top = this.stage.querySelector('.stack.top');
    const label = this.stage.querySelector('.compare-label');
    if (top) top.hidden = !this.showRight;
    if (label) label.textContent = this.showRight ? `Right: photo ${this.number(this.right)}` : `Left: photo ${this.number(this.left)}`;
  }

  number(index) {
    return this.group.members.findIndex((m) => m.index === index) + 1;
  }

  image(index, className) {
    const url = this.urlFor(index);
    return url
      ? h('img', { src: url, alt: `Photo ${this.number(index)}`, class: className, decoding: 'async' })
      : h('p', { class: 'muted', text: 'No preview available for this file.' });
  }

  render() {
    this.stop();
    for (const button of this.dialog.querySelectorAll('[data-mode]')) {
      button.setAttribute('aria-checked', String(button.getAttribute('data-mode') === this.mode));
    }
    const stage = this.stage;
    stage.replaceChildren();
    stage.classList.toggle('single', this.mode !== 'side');
    const leftLabel = h('span', { class: 'compare-label left', text: `Left: photo ${this.number(this.left)} (keeper)` });
    const rightLabel = h('span', { class: 'compare-label right', text: `Right: photo ${this.number(this.right)}` });

    if (this.mode === 'side') {
      stage.append(h('div', { class: 'compare-pane' }, leftLabel, this.image(this.left)), h('div', { class: 'compare-pane' }, rightLabel, this.image(this.right)));
    } else if (this.mode === 'slider') {
      const top = this.image(this.right, 'stack top');
      const line = h('div', { class: 'split-line' });
      const apply = () => {
        top.style.clipPath = `inset(0 0 0 ${this.split}%)`;
        line.style.left = `${this.split}%`;
      };
      apply();
      const range = h('input', {
        type: 'range',
        min: 0,
        max: 100,
        value: this.split,
        class: 'range-full',
        'aria-label': 'Split position between left and right photo',
      });
      range.addEventListener('input', () => {
        this.split = Number(range.value);
        apply();
      });
      stage.append(h('div', { class: 'compare-pane' }, leftLabel, rightLabel, this.image(this.left, 'stack'), top, line), range);
    } else if (this.mode === 'flicker') {
      this.showRight = true;
      const label = h('span', { class: 'compare-label left', 'aria-live': 'off', text: `Right: photo ${this.number(this.right)}` });
      stage.append(h('div', { class: 'compare-pane' }, label, this.image(this.left, 'stack'), this.image(this.right, 'stack top')));
      const reduced = globalThis.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (!reduced) this.timer = setInterval(() => this.flip(), FLICKER_MS);
      stage.append(h('p', { class: 'muted', text: reduced ? 'Press Space to switch between the photos.' : 'Switching every 0.7 s — press Space to switch by hand.' }));
    } else {
      const pane = h('div', { class: 'compare-pane' }, h('p', { class: 'muted', text: 'Computing the difference…' }));
      stage.append(pane);
      this.renderDifference(pane);
    }
    this.renderControls();
  }

  async renderDifference(pane) {
    const token = ++this.renderToken;
    const fa = this.fileFor(this.left);
    const fb = this.fileFor(this.right);
    try {
      if (!fa || !fb) throw new Error('missing file');
      const first = await createImageBitmap(fa);
      const width = Math.min(DIFFERENCE_WIDTH, first.width);
      const height = Math.max(1, Math.round((first.height * width) / first.width));
      first.close();
      const [a, b] = await Promise.all([
        createImageBitmap(fa, { resizeWidth: width, resizeHeight: height, resizeQuality: 'high' }),
        createImageBitmap(fb, { resizeWidth: width, resizeHeight: height, resizeQuality: 'high' }),
      ]);
      if (token !== this.renderToken) return;
      const canvas = h('canvas', { width, height, role: 'img', 'aria-label': 'Pixel difference: dark means equal, bright means different' });
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(a, 0, 0);
      const pa = ctx.getImageData(0, 0, width, height);
      ctx.drawImage(b, 0, 0);
      const pb = ctx.getImageData(0, 0, width, height);
      a.close();
      b.close();
      let total = 0;
      for (let i = 0; i < pa.data.length; i += 4) {
        for (let c = 0; c < 3; c++) {
          const d = Math.abs(pa.data[i + c] - pb.data[i + c]);
          total += d;
          pa.data[i + c] = Math.min(255, d * 4);
        }
        pa.data[i + 3] = 255;
      }
      ctx.putImageData(pa, 0, 0);
      const mean = total / (width * height * 3);
      pane.replaceChildren(
        h('span', { class: 'compare-label left', text: `Difference ×4 · mean ${mean.toFixed(1)} of 255` }),
        canvas,
      );
    } catch {
      if (token === this.renderToken) pane.replaceChildren(h('p', { class: 'muted', text: 'The difference could not be computed for these files.' }));
    }
  }

  renderControls() {
    const side = (index, label) => {
      const select = h('select', { 'aria-label': `${label} photo` });
      this.group.members.forEach((m, n) => {
        select.append(h('option', { value: m.index, selected: m.index === index, text: `Photo ${n + 1}${m.keeper ? ' (keeper)' : ''}` }));
      });
      select.addEventListener('change', () => {
        const value = Number(select.value);
        if (label === 'Left') {
          if (value === this.right) this.right = this.left;
          this.left = value;
        } else {
          if (value === this.left) this.left = this.right;
          this.right = value;
        }
        this.render();
      });
      const decision = this.decisionOf(this.group, index);
      const keep = h('button', { type: 'button', class: 'button keep-button', 'aria-pressed': String(decision === 'keep'), onclick: () => this.decide(index, 'keep') }, icon('keep'), 'Keep');
      const remove = h('button', { type: 'button', class: 'button remove-button', 'aria-pressed': String(decision === 'remove'), onclick: () => this.decide(index, 'remove') }, icon('remove'), 'Remove');
      const other = index === this.left ? this.right : this.left;
      return h(
        'div',
        { class: 'compare-side' },
        h('div', { class: 'row' }, h('strong', { text: label }), select, h('span', { class: 'score', text: `${formatScore(this.scoreOf(index, other))} vs. other` })),
        this.describe(index),
        h('div', { class: 'row decision' }, keep, remove),
      );
    };
    this.controls.replaceChildren(side(this.left, 'Left'), side(this.right, 'Right'));
  }
}
