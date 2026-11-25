// Tests for the generated move scripts: quoting rules, and — where the shells
// are installed — real runs against temporary folders with hostile file names.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  quotePowerShell,
  quoteShell,
  isPlainRelativePath,
  powerShellScript,
  shellScript,
  describeRunLocation,
  sanitizeComment,
  DEFAULT_REVIEW_FOLDER,
} from '../src/export/scripts.js';

const run = promisify(execFile);
const isWindows = process.platform === 'win32';

/** Names that are legal on every platform but dangerous in shells. */
const HOSTILE = [
  'plain.jpg',
  'with space.jpg',
  "it's.jpg",
  'it\u2019s typographic.jpg',
  'dollar $HOME $(whoami).jpg',
  'back`tick`.jpg',
  '-leading-dash.jpg',
  '--apply.jpg',
  'semi;colon & amp.jpg',
  'brackets [1] {2} (3).jpg',
  'percent %PATH% hash #1.jpg',
  'caf\u00e9 \u65e5\u672c \u0645\u0631\u062d\u0628\u0627 \u{1f4f7}.jpg',
  "sub dir/nested'quote/double.jpg",
  'sub dir/-dash dir/x.jpg',
];

test('PowerShell quoting doubles every kind of single quote', () => {
  assert.equal(quotePowerShell('plain'), "'plain'");
  assert.equal(quotePowerShell("it's"), "'it''s'");
  assert.equal(quotePowerShell('a\u2019b'), "'a\u2019\u2019b'");
  assert.equal(quotePowerShell('a\u2018b\u201ac\u201bd'), "'a\u2018\u2018b\u201a\u201ac\u201b\u201bd'");
  assert.equal(quotePowerShell('$x `y` "z"'), "'$x `y` \"z\"'", '$, backticks and double quotes stay literal');
});

test('sh quoting closes, escapes and reopens single quotes', () => {
  assert.equal(quoteShell('plain'), "'plain'");
  assert.equal(quoteShell("it's"), "'it'\\''s'");
  assert.equal(quoteShell('$(rm -rf ~) `x` "y" \\z'), "'$(rm -rf ~) `x` \"y\" \\z'");
  assert.equal(quoteShell(''), "''");
});

test('invalid relative paths are rejected and left out of the scripts', () => {
  for (const ok of ['a.jpg', 'dir/a.jpg', '-x/..y.jpg', '.hidden/a.jpg']) assert.ok(isPlainRelativePath(ok), ok);
  for (const bad of ['', '/etc/passwd', '\\\\server\\share', 'C:/x.jpg', 'a/../b.jpg', '../a.jpg', 'a//b.jpg', './a.jpg', 'a\0b']) {
    assert.ok(!isPlainRelativePath(bad), JSON.stringify(bad));
  }
  const ps = powerShellScript(['ok.jpg', '../escape.jpg']);
  const sh = shellScript(['ok.jpg', '../escape.jpg']);
  assert.ok(!ps.includes('escape.jpg') && !sh.includes('escape.jpg'));
});

test('scripts are dry runs by default, contain no delete commands and list every path once', () => {
  const ps = powerShellScript(HOSTILE, { version: '0.1.0', runLocation: 'Run it here.' });
  const sh = shellScript(HOSTILE, { version: '0.1.0' });
  for (const script of [ps, sh]) {
    assert.doesNotMatch(script, /\bRemove-Item\b|\brm\s|\bdel\s|\bunlink\b|Delete\(/i, 'no delete commands');
    assert.match(script, new RegExp(DEFAULT_REVIEW_FOLDER));
  }
  assert.match(ps, /\[switch\]\$Apply/);
  assert.match(ps, /-LiteralPath/);
  assert.match(sh, /apply=0/);
  assert.match(sh, /mv -i -- "\$src" "\$dst"/);
  for (const name of HOSTILE) {
    assert.ok(ps.includes(quotePowerShell(name)), `ps contains ${name}`);
    assert.ok(sh.includes(`move_one ${quoteShell(name)}`), `sh contains ${name}`);
  }
  assert.ok(ps.includes('\r\n'), 'PowerShell script uses CRLF');
  assert.ok(!sh.includes('\r'), 'sh script uses LF');
});

test('run location advice', () => {
  assert.equal(describeRunLocation(['Photos/a.jpg', 'Photos/2020/b.jpg']).kind, 'single-folder');
  assert.equal(describeRunLocation(['Photos/a.jpg']).folder, 'Photos');
  assert.equal(describeRunLocation(['a.jpg', 'b.jpg']).kind, 'loose-files');
  assert.equal(describeRunLocation(['A/a.jpg', 'B/b.jpg']).kind, 'mixed');
});

/** Folder names that would break out of a comment in the script header. */
const HOSTILE_FOLDERS = ['x#> Write-Output INJECTED <#y', 'x\necho INJECTED\n#', 'x\r\nWrite-Output INJECTED'];

test('folder names in the header stay inside the comment', () => {
  assert.equal(sanitizeComment('a#>b<#c\nd\re\u2028f'), 'a#?b?#c?d?e?f');
  for (const folder of HOSTILE_FOLDERS) {
    const runLocation = describeRunLocation([`${folder}/a.jpg`]).text;
    const ps = powerShellScript([`${folder}/a.jpg`], { runLocation });
    const sh = shellScript([`${folder}/a.jpg`], { runLocation });
    const psHeader = ps.slice(0, ps.indexOf('#>') + 2);
    assert.ok(psHeader.endsWith('\r\n#>'), 'the first "#>" is the real end of the comment block');
    assert.ok(ps.includes(quotePowerShell(`${folder}/a.jpg`)), 'the path itself is a quoted literal');
    const shHeader = sh.slice(0, sh.indexOf('\nset -u'));
    for (const line of shHeader.split('\n').filter(Boolean)) assert.ok(line.startsWith('#'), `header line is a comment: ${JSON.stringify(line)}`);
  }
});

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function makeTree(names) {
  const dir = await mkdtemp(path.join(tmpdir(), 'dupelens-script-'));
  for (const name of names) {
    const file = path.join(dir, ...name.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, `content of ${name}`);
  }
  return dir;
}

async function findShell() {
  const candidates = isWindows ? ['C:\\Program Files\\Git\\bin\\sh.exe', 'C:\\Program Files\\Git\\usr\\bin\\sh.exe'] : ['/bin/sh'];
  for (const candidate of candidates) if (await exists(candidate)) return candidate;
  return null;
}

async function findPowerShell() {
  for (const candidate of isWindows ? ['powershell.exe', 'pwsh.exe'] : ['pwsh']) {
    try {
      await run(candidate, ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major']);
      return candidate;
    } catch {
      // not installed
    }
  }
  return null;
}

test('sh script moves hostile names into the review folder only with --apply', async (t) => {
  const shell = await findShell();
  if (!shell) return t.skip('no POSIX shell found');
  const names = [...HOSTILE, 'keep me.jpg'];
  const dir = await makeTree(names);
  try {
    const scriptPath = path.join(dir, 'dupelens-move.sh');
    await writeFile(scriptPath, shellScript([...HOSTILE, 'not-there.jpg']));
    const dry = await run(shell, [scriptPath, '--root', dir]);
    assert.match(dry.stdout, /Dry run: 14 file\(s\) would be moved, 1 skipped/);
    for (const name of names) assert.ok(await exists(path.join(dir, ...name.split('/'))), `dry run keeps ${name}`);

    const applied = await run(shell, [scriptPath, '--root', dir, '--apply']);
    assert.match(applied.stdout, /Done: 14 moved, 1 skipped, 0 failed/);
    for (const name of HOSTILE) {
      assert.ok(!(await exists(path.join(dir, ...name.split('/')))), `moved away: ${name}`);
      const target = path.join(dir, DEFAULT_REVIEW_FOLDER, ...name.split('/'));
      assert.equal(await readFile(target, 'utf8'), `content of ${name}`, `content intact: ${name}`);
    }
    assert.ok(await exists(path.join(dir, 'keep me.jpg')));

    // A second run finds nothing to move and overwrites nothing.
    await writeFile(path.join(dir, 'plain.jpg'), 'new file with the same name');
    const again = await run(shell, [scriptPath, '--root', dir, '--apply']).catch((e) => e);
    assert.match(again.stdout, /Done: 0 moved/);
    assert.equal(await readFile(path.join(dir, DEFAULT_REVIEW_FOLDER, 'plain.jpg'), 'utf8'), 'content of plain.jpg');
    assert.equal(await readFile(path.join(dir, 'plain.jpg'), 'utf8'), 'new file with the same name');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('PowerShell script moves hostile names into the review folder only with -Apply', async (t) => {
  const shell = await findPowerShell();
  if (!shell) return t.skip('PowerShell not found');
  const names = [...HOSTILE, 'keep me.jpg'];
  const dir = await makeTree(names);
  try {
    const scriptPath = path.join(dir, 'dupelens-move.ps1');
    // Saved with a UTF-8 byte order mark, as the app does.
    await writeFile(scriptPath, '\ufeff' + powerShellScript([...HOSTILE, 'not-there.jpg']));
    const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-Root', dir];
    const dry = await run(shell, args);
    assert.match(dry.stdout, /Dry run: 14 file\(s\) would be moved, 1 skipped/);
    for (const name of names) assert.ok(await exists(path.join(dir, ...name.split('/'))), `dry run keeps ${name}`);

    const applied = await run(shell, [...args, '-Apply']);
    assert.match(applied.stdout, /Done: 14 moved, 1 skipped, 0 failed/);
    for (const name of HOSTILE) {
      assert.ok(!(await exists(path.join(dir, ...name.split('/')))), `moved away: ${name}`);
      const target = path.join(dir, DEFAULT_REVIEW_FOLDER, ...name.split('/'));
      assert.equal(await readFile(target, 'utf8'), `content of ${name}`, `content intact: ${name}`);
    }
    assert.ok(await exists(path.join(dir, 'keep me.jpg')));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
