#!/usr/bin/env node
// Prints the CHANGELOG.md section of one version, e.g. for GitHub release notes.
//
//   node tools/changelog-section.mjs 0.1.0
//   node tools/changelog-section.mjs v0.1.0
//   node tools/changelog-section.mjs Unreleased

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/**
 * Extracts the body of a `## [version]` section from Keep-a-Changelog text.
 * @param {string} changelog full file content
 * @param {string} version e.g. "0.1.0", "v0.1.0" or "Unreleased"
 * @returns {string | null} the section body without its heading, or null
 */
export function changelogSection(changelog, version) {
  const wanted = version.replace(/^v/, '');
  const lines = changelog.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let inside = false;
  for (const line of lines) {
    const heading = /^## \[([^\]]+)\]/.exec(line);
    if (heading) {
      if (inside) break;
      inside = heading[1] === wanted;
      continue;
    }
    // Link reference definitions at the end of the file end every section.
    if (inside && /^\[[^\]]+\]: /.test(line)) break;
    if (inside) out.push(line);
  }
  if (!inside && out.length === 0) return null;
  return out.join('\n').trim() + '\n';
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const version = process.argv[2];
  if (!version) {
    console.error('usage: node tools/changelog-section.mjs <version>');
    process.exit(2);
  }
  const text = await readFile(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  const section = changelogSection(text, version);
  if (section === null) {
    console.error(`CHANGELOG.md has no section for ${version}`);
    process.exit(1);
  }
  process.stdout.write(section);
}
