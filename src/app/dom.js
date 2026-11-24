// Tiny DOM helpers. Text is set through textContent, not as markup.

/**
 * Creates an element.
 * @param {string} tag
 * @param {Record<string, any>} [props] attributes; `class`, `text`, `on*`
 *   handlers and boolean attributes are supported
 * @param {...(Node | string | null | undefined | false)} children
 * @returns {HTMLElement}
 */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child);
  }
  return el;
}

/**
 * @param {string} id
 * @returns {any}
 */
export function byId(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element #${id}`);
  return el;
}

/**
 * Triggers a download of generated text.
 * @param {string} name
 * @param {string} content
 * @param {string} type MIME type
 */
export function downloadText(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** True when the keyboard event comes from a text field or similar. */
export function isTypingTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = /** @type {HTMLInputElement} */ (target).type;
    return !['button', 'checkbox', 'radio', 'file'].includes(type);
  }
  return false;
}

/**
 * localStorage access that does not throw (incognito windows, blocked storage).
 */
export const preferences = {
  get(key) {
    try {
      return globalThis.localStorage ? localStorage.getItem(key) : null;
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      if (globalThis.localStorage) localStorage.setItem(key, value);
    } catch {
      // ignore
    }
  },
};
