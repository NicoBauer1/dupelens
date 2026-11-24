// Inline SVG icons drawn for this project (24 × 24 grid, stroked with the
// current text colour). Built with DOM APIs, no markup strings.

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Each icon is a list of [element, attributes] drawn with a 1.8 px stroke. */
const ICONS = {
  photos: [
    ['rect', { x: 3, y: 6, width: 14, height: 12, rx: 2 }],
    ['path', { d: 'M7 3h12a2 2 0 0 1 2 2v10' }],
    ['path', { d: 'M3 15l4-4 3 3 2-2 5 5' }],
    ['circle', { cx: 13, cy: 10, r: 1.3 }],
  ],
  image: [
    ['rect', { x: 3, y: 4, width: 18, height: 16, rx: 2 }],
    ['path', { d: 'M3 16l5-5 4 4 3-3 6 6' }],
    ['circle', { cx: 15.5, cy: 8.5, r: 1.5 }],
  ],
  folder: [['path', { d: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z' }]],
  lock: [
    ['rect', { x: 5, y: 11, width: 14, height: 10, rx: 2 }],
    ['path', { d: 'M8 11V8a4 4 0 0 1 8 0v3' }],
  ],
  eye: [
    ['path', { d: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z' }],
    ['circle', { cx: 12, cy: 12, r: 3 }],
  ],
  shield: [
    ['path', { d: 'M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z' }],
    ['path', { d: 'M8.5 12l2.5 2.5 4.5-5' }],
  ],
  download: [['path', { d: 'M12 4v11M7 10l5 5 5-5M5 20h14' }]],
  plus: [['path', { d: 'M12 5v14M5 12h14' }]],
  restart: [['path', { d: 'M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4' }]],
  close: [['path', { d: 'M6 6l12 12M18 6L6 18' }]],
  help: [
    ['circle', { cx: 12, cy: 12, r: 9 }],
    ['path', { d: 'M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17.2v.3' }],
  ],
  theme: [
    ['circle', { cx: 12, cy: 12, r: 8 }],
    ['path', { d: 'M12 4a8 8 0 0 1 0 16z', fill: 'currentColor' }],
  ],
  compare: [
    ['rect', { x: 3, y: 5, width: 7, height: 14, rx: 1.5 }],
    ['rect', { x: 14, y: 5, width: 7, height: 14, rx: 1.5 }],
    ['path', { d: 'M12 3v18' }],
  ],
  keep: [['path', { d: 'M5 12.5l4.5 4.5L19 7.5' }]],
  remove: [['path', { d: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M12 11v6' }]],
  check: [
    ['circle', { cx: 12, cy: 12, r: 9 }],
    ['path', { d: 'M8 12.5l3 3 5-6' }],
  ],
  equal: [['path', { d: 'M5 9h14M5 15h14' }]],
  undo: [['path', { d: 'M9 7L4 12l5 5M4 12h11a5 5 0 0 1 0 10h-2' }]],
  star: [['path', { d: 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z' }]],
  warning: [
    ['path', { d: 'M12 3l10 18H2z' }],
    ['path', { d: 'M12 10v5M12 18v.3' }],
  ],
  chevronLeft: [['path', { d: 'M15 5l-7 7 7 7' }]],
  chevronRight: [['path', { d: 'M9 5l7 7-7 7' }]],
};

/**
 * @param {keyof typeof ICONS | 'logo'} name
 * @returns {SVGSVGElement}
 */
export function icon(name) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', name === 'logo' ? '0 0 32 32' : '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('icon', `icon-${name}`);
  if (name === 'logo') {
    const shapes = [
      ['rect', { x: 3, y: 5, width: 17, height: 17, rx: 3, class: 'logo-back' }],
      ['rect', { x: 11, y: 10, width: 17, height: 17, rx: 3, class: 'logo-front' }],
      ['path', { d: 'M15 18.5l3 3 5.5-6', class: 'logo-check' }],
    ];
    for (const [tag, attrs] of shapes) svg.append(svgElement(tag, attrs));
    return svg;
  }
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  for (const [tag, attrs] of ICONS[name] || []) svg.append(svgElement(tag, attrs));
  return svg;
}

function svgElement(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  return el;
}

/**
 * Replaces every element with a data-icon attribute by the icon.
 * @param {ParentNode} root
 */
export function hydrateIcons(root = document) {
  for (const el of root.querySelectorAll('[data-icon]')) {
    el.replaceChildren(icon(/** @type {any} */ (el.getAttribute('data-icon'))));
  }
}
