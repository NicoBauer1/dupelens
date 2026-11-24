import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

test('package.json declares no dependencies of any kind', async () => {
  const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'bundleDependencies']) {
    const entries = pkg[field] ? Object.keys(pkg[field]) : [];
    assert.deepEqual(entries, [], `${field} must stay empty`);
  }
});

test('the licence is MIT and names the project contributors', async () => {
  const licence = await readFile(new URL('LICENSE', root), 'utf8');
  assert.match(licence, /^MIT License/);
  assert.match(licence, /Copyright \(c\) 2026 the project contributors/);
});

test('every path is owned by a code owner', async () => {
  const owners = await readFile(new URL('.github/CODEOWNERS', root), 'utf8');
  assert.match(owners, /^\* @\S+$/m);
});
