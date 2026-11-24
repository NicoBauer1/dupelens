import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { APP_VERSION } from '../src/app/version.js';
import { CONTENT_SECURITY_POLICY, resolveInside } from '../tools/serve.mjs';
import { formatBytes, formatScore, formatResolution, formatDuration, plural } from '../src/app/format.js';
import path from 'node:path';

const root = new URL('../', import.meta.url);

test('the app version matches package.json', async () => {
  const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
  assert.equal(APP_VERSION, pkg.version);
});

test('index.html forbids network access and only loads its own files', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');
  const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html)[1];
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /connect-src 'none'/);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|https?:/);
  assert.doesNotMatch(html, /\b(src|href)="https?:/);
  for (const directive of ["connect-src 'none'", "default-src 'none'", "object-src 'none'"]) assert.ok(CONTENT_SECURITY_POLICY.includes(directive));
});

test('the development server only serves files inside the repository', () => {
  const base = path.resolve('/srv/app');
  assert.equal(resolveInside(base, '/index.html'), path.join(base, 'index.html'));
  assert.equal(resolveInside(base, '/src/app/main.js?x=1'), path.join(base, 'src', 'app', 'main.js'));
  assert.equal(resolveInside(base, '/../secret.txt'), path.join(base, 'secret.txt'), 'normalised to the root');
  assert.equal(resolveInside(base, '/%2e%2e/%2e%2e/etc/passwd'), path.join(base, 'etc', 'passwd'));
  assert.equal(resolveInside(base, '/a%00b'), null);
  assert.equal(resolveInside(base, '/%E0%A4%A'), null, 'malformed escapes are rejected');
});

test('formatting helpers', () => {
  assert.equal(formatBytes(999), '999 B');
  assert.equal(formatBytes(1500), '1.5 kB');
  assert.equal(formatBytes(12_345_678), '12 MB');
  assert.equal(formatBytes(-1), '—');
  assert.equal(formatScore(100), '100 %');
  assert.equal(formatScore(97.25), '97.3 %');
  assert.equal(formatResolution(4000, 3000), '4000 × 3000 (12.0 MP)');
  assert.equal(formatResolution(0, 0), '—');
  assert.equal(formatDuration(75), '1 min 15 s');
  assert.equal(plural(1, 'group'), '1 group');
  assert.equal(plural(1234, 'photo'), '1,234 photos');
});
