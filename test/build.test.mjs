import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { buildHtml, transformModule } from '../tools/build.mjs';

const first = await buildHtml();
const second = await buildHtml();
const html = first.html;
const script = /<script>([\s\S]*?)<\/script>/.exec(html)[1];
const style = /<style>([\s\S]*?)<\/style>/.exec(html)[1];
const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html)[1];
const hash = (text) => `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;

test('the build is reproducible', () => {
  assert.equal(first.html, second.html);
});

test('the single file has no external resources', () => {
  assert.doesNotMatch(html, /<script[^>]+src=/i);
  assert.doesNotMatch(html, /<link[^>]+rel="stylesheet"/i);
  assert.equal((html.match(/<script>/g) || []).length, 1, 'exactly one inline script');
  assert.equal((html.match(/<style>/g) || []).length, 1, 'exactly one inline style');
});

test('the Content-Security-Policy pins the inline script and style by hash and blocks the network', () => {
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /connect-src 'none'/);
  assert.match(csp, /worker-src blob:/);
  assert.ok(csp.includes(`script-src ${hash(script)}`), 'script hash');
  assert.ok(csp.includes(`style-src ${hash(style)}`), 'style hash');
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|https?:|'self'/);
});

test('the bundled app and the embedded worker are valid classic scripts', () => {
  assert.doesNotThrow(() => new vm.Script(script, { filename: 'app.js' }));
  const embedded = /const WORKER_SOURCE = (".*");/.exec(script);
  assert.ok(embedded, 'worker source is embedded');
  const worker = JSON.parse(embedded[1]);
  assert.doesNotThrow(() => new vm.Script(worker, { filename: 'worker.js' }));
  for (const code of [script, worker]) {
    assert.doesNotMatch(code, /^\s*(import|export)\s/m, 'no module syntax left');
    assert.doesNotMatch(code, /import\.meta/);
  }
  assert.ok(first.modules.includes('src/engine/matcher.js'));
  assert.ok(first.workerModules.includes('src/engine/fingerprint.js'));
  assert.ok(!first.workerModules.includes('src/app/main.js'), 'the worker does not contain the UI');
});

test('the embedded worker answers a ping in a minimal worker realm', async () => {
  const worker = JSON.parse(/const WORKER_SOURCE = (".*");/.exec(script)[1]);
  const messages = [];
  const self = { postMessage: (m) => messages.push(m) };
  vm.runInNewContext(worker, { self, Float32Array, Float64Array, Uint8Array, Uint32Array, Int32Array, Uint8ClampedArray, Map, Set, Math, Object, Array, String, Number, Promise, Error, RangeError, JSON, TextEncoder });
  await self.onmessage({ data: { type: 'ping' } });
  // Objects from another realm: compare their JSON form.
  assert.equal(JSON.stringify(messages), JSON.stringify([{ type: 'pong', canDecode: false }]), 'no canvas in this realm, so decoding is reported as unavailable');
});

test('the bundler rejects unsupported module syntax', () => {
  const names = new Map([['a.js', '__a'], ['b.js', '__b']]);
  assert.throws(() => transformModule('a.js', 'export default 1;\n', names), /default export/);
  assert.throws(() => transformModule('a.js', "import * as b from './b.js';\n", names), /only `import/);
  assert.throws(() => transformModule('a.js', "import { x as y } from './b.js';\n", names), /renamed import/);
  assert.throws(() => transformModule('a.js', "const m = import('./b.js');\n", names), /dynamic import/);
  assert.throws(() => transformModule('a.js', 'const u = import.meta.url;\n', names), /import\.meta/);
  assert.throws(() => transformModule('a.js', 'const x = 1;\nexport { x };\n', names), /re-export/);
  const ok = transformModule('a.js', "import { y } from './b.js';\n/** @type {import('./b.js').T} */\nexport function x() { return y; }\n", names);
  assert.match(ok.code, /const \{ y \} = __b;/);
  assert.match(ok.code, /return \{ x \};/);
});
