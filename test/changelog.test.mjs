import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { changelogSection } from '../tools/changelog-section.mjs';

const sample = `# Changelog

## [Unreleased]

### Added

- Something new.

## [0.2.0] - 2027-01-10

### Fixed

- A bug.

## [0.1.0] - 2026-12-01

### Added

- First release.

[Unreleased]: https://example.invalid/compare/v0.2.0...develop
[0.2.0]: https://example.invalid/compare/v0.1.0...v0.2.0
`;

test('extracts a released section without its heading', () => {
  assert.equal(changelogSection(sample, '0.2.0'), '### Fixed\n\n- A bug.\n');
});

test('accepts a leading v and stops before link definitions', () => {
  assert.equal(changelogSection(sample, 'v0.1.0'), '### Added\n\n- First release.\n');
});

test('extracts the Unreleased section', () => {
  assert.equal(changelogSection(sample, 'Unreleased'), '### Added\n\n- Something new.\n');
});

test('returns null for an unknown version', () => {
  assert.equal(changelogSection(sample, '9.9.9'), null);
});

test('handles CRLF line endings', () => {
  assert.equal(changelogSection(sample.replace(/\n/g, '\r\n'), '0.2.0'), '### Fixed\n\n- A bug.\n');
});

test('the real CHANGELOG.md has an Unreleased section', async () => {
  const text = await readFile(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  const section = changelogSection(text, 'Unreleased');
  // Right after a release the section is empty (see docs/RELEASING.md), so only its presence is required.
  assert.notEqual(section, null, 'CHANGELOG.md has an [Unreleased] section');
});
