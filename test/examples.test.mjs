import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const script = fileURLToPath(new URL('../tools/make-samples.mjs', import.meta.url));

test('examples/ matches what tools/make-samples.mjs generates', async () => {
  const { stdout } = await run(process.execPath, [script, '--check']);
  assert.match(stdout, /up to date/);
});
