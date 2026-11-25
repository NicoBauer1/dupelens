#!/usr/bin/env node
// Builds the single self-contained file dist/dupelens.html.
//
// A deliberately small bundler for this code base. Its rules:
//   - imports are named and static:  import { a, b } from './x.js';
//   - exports are declarations:      export function / class / const / let / async function
//   - no default exports, no re-exports, no `import * as`, no dynamic import()
// Each module is wrapped in its own function scope and returns its exports;
// modules are emitted in dependency order. The analysis worker is bundled the
// same way and embedded as a string, started from a Blob URL at runtime.
//
// The output is reproducible: the same sources always give the same bytes.
//
//   node tools/build.mjs            # writes dist/dupelens.html
//   node tools/build.mjs --out DIR  # writes DIR/dupelens.html

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

const IMPORT_RE = /^import\s*\{([^}]*)\}\s*from\s*'([^']+)';[ \t]*$/gm;
const EXPORT_RE = /^export\s+(?:async\s+)?(function\*?|class|const|let)\s+([A-Za-z_$][\w$]*)/gm;

/** Modules replaced in the single-file build (path relative to ROOT). */
const SUBSTITUTES = {
  'src/app/worker-factory.js': (workerSource) => [
    '// Single-file build: the worker source is embedded and started from a Blob URL.',
    `const WORKER_SOURCE = ${JSON.stringify(workerSource).replace(/<\//g, '<\\/')};`,
    'let workerUrl = null;',
    'export function createAnalysisWorker() {',
    "  if (!workerUrl) workerUrl = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }));",
    '  return new Worker(workerUrl);',
    '}',
    '',
  ].join('\n'),
};

const read = async (file) => (await readFile(file, 'utf8')).replace(/\r\n/g, '\n');
const toPosix = (p) => p.split(path.sep).join('/');

/**
 * Turns one ES module into a function-scoped block.
 * @param {string} id posix path relative to ROOT
 * @param {string} source
 * @param {Map<string, string>} names module id -> variable name
 */
export function transformModule(id, source, names) {
  const problems = [];
  // JSDoc types such as {import('./x.js').Type} live in comments, not in code.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');
  if (/^\s*export\s+default\b/m.test(code)) problems.push('default export');
  if (/^\s*export\s*[{*]/m.test(code)) problems.push('re-export or export list');
  if (/^\s*import\s+(?!\{)/m.test(code)) problems.push('only `import { ... } from` is supported');
  if (/\bimport\s*\(/.test(code)) problems.push('dynamic import()');
  if (/\bimport\.meta\b/.test(code)) problems.push('import.meta');
  const imports = [];
  let body = source.replace(IMPORT_RE, (_, list, from) => {
    if (/\bas\b/.test(list)) problems.push(`renamed import from ${from}`);
    const target = toPosix(path.posix.normalize(path.posix.join(path.posix.dirname(id), from)));
    imports.push({ names: list.split(',').map((n) => n.trim()).filter(Boolean), from: target });
    return '';
  });
  if (/^import\s/m.test(body)) problems.push('unparsed import statement');
  if (problems.length) throw new Error(`${id}: ${problems.join(', ')}`);
  const exported = [];
  body = body.replace(EXPORT_RE, (match, kind, name) => {
    exported.push(name);
    return match.replace(/^export\s+/, '');
  });
  const header = imports.map(({ names: list, from }) => {
    const variable = names.get(from);
    if (!variable) throw new Error(`${id}: unknown module ${from}`);
    return `const { ${list.join(', ')} } = ${variable};`;
  });
  return {
    imports: imports.map((i) => i.from),
    code: [
      `// ---- ${id}`,
      `const ${names.get(id)} = (() => {`,
      ...header,
      body.trim(),
      `return { ${exported.join(', ')} };`,
      '})();',
    ].join('\n'),
  };
}

/**
 * Bundles an entry module and its dependencies into one classic script.
 * @param {string} entry posix path relative to ROOT
 * @param {Record<string, string>} [substitutes] module id -> replacement source
 */
export async function bundle(entry, substitutes = {}) {
  const sources = new Map();
  const order = [];
  const visiting = new Set();
  const names = new Map();
  const variableFor = (id) => `__module_${id.replace(/\.js$/, '').replace(/[^A-Za-z0-9]/g, '_')}`;

  async function visit(id) {
    if (sources.has(id)) return;
    if (visiting.has(id)) throw new Error(`circular import involving ${id}`);
    visiting.add(id);
    const source = substitutes[id] ?? (await read(path.join(ROOT, id)));
    names.set(id, variableFor(id));
    const deps = [];
    for (const match of source.matchAll(IMPORT_RE)) {
      deps.push(toPosix(path.posix.normalize(path.posix.join(path.posix.dirname(id), match[2]))));
    }
    for (const dep of deps) await visit(dep);
    visiting.delete(id);
    sources.set(id, source);
    order.push(id);
  }
  await visit(entry);
  const parts = order.map((id) => transformModule(id, sources.get(id), names).code);
  return { code: `(() => {\n'use strict';\n${parts.join('\n\n')}\n})();\n`, modules: order };
}

const cspHash = (text) => `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;

/**
 * Builds the HTML text of the single-file app.
 * @returns {Promise<{ html: string, modules: string[], workerModules: string[] }>}
 */
export async function buildHtml() {
  const worker = await bundle('src/app/worker.js');
  const app = await bundle('src/app/main.js', { 'src/app/worker-factory.js': SUBSTITUTES['src/app/worker-factory.js'](worker.code) });
  const css = (await read(path.join(ROOT, 'src/app/styles.css'))).trim();
  let html = await read(path.join(ROOT, 'index.html'));

  for (const [text, closing] of [[app.code, '</script'], [css, '</style']]) {
    if (text.toLowerCase().includes(closing)) throw new Error(`inline content must not contain ${closing}`);
  }
  if (app.code.includes('<!--')) throw new Error('inline script must not contain <!--');

  const style = `\n${css}\n`;
  const script = `\n${app.code}`;
  const csp = [
    "default-src 'none'",
    `script-src ${cspHash(script)}`,
    `style-src ${cspHash(style)}`,
    'img-src blob: data:',
    'worker-src blob:',
    "connect-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'",
  ].join('; ');

  const replaceOnce = (pattern, replacement) => {
    if (!pattern.test(html)) throw new Error(`index.html does not match ${pattern}`);
    html = html.replace(pattern, () => replacement);
  };
  replaceOnce(/<meta http-equiv="Content-Security-Policy" content="[^"]*">/, `<meta http-equiv="Content-Security-Policy" content="${csp}">`);
  replaceOnce(/<link rel="stylesheet" href="src\/app\/styles\.css">/, `<style>${style}</style>`);
  replaceOnce(/<script type="module" src="src\/app\/main\.js"><\/script>/, `<script>${script}</script>`);
  if (/<script[^>]+src=|<link[^>]+rel="stylesheet"/i.test(html)) throw new Error('external resources left in the HTML');
  return { html, modules: app.modules, workerModules: worker.modules };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const outIndex = process.argv.indexOf('--out');
  const outDir = outIndex >= 0 ? path.resolve(process.argv[outIndex + 1]) : path.join(ROOT, 'dist');
  const { html, modules, workerModules } = await buildHtml();
  await mkdir(outDir, { recursive: true });
  const target = path.join(outDir, 'dupelens.html');
  await writeFile(target, html);
  const digest = createHash('sha256').update(html).digest('hex');
  console.log(`built ${path.relative(process.cwd(), target) || target}`);
  console.log(`  ${(Buffer.byteLength(html) / 1024).toFixed(1)} KiB, ${modules.length} app modules, ${workerModules.length} worker modules`);
  console.log(`  sha256 ${digest}`);
}
