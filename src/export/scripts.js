// Generates move scripts for the files marked "remove".
//
// The scripts contain no delete commands. They move each file into a review folder
// (default `_dupelens_review/`) under the same relative path, refuse to
// overwrite existing files, and only print what they would do unless the
// apply flag is given. Every path is embedded as a literal string:
//
// - PowerShell: single-quoted strings, in which only the quote characters are
//   special. PowerShell treats ' and the typographic quotes ‘ ’ ‚ ‛ alike, so
//   each of them is doubled. File system access uses -LiteralPath and .NET
//   methods, which do not interpret wildcards such as [ ] * ?.
// - POSIX sh: single-quoted strings, in which nothing is special except the
//   single quote itself; it is written as '\'' (close, escaped quote, reopen).
//   Every command gets `--` before its path operands.

export const DEFAULT_REVIEW_FOLDER = '_dupelens_review';

/**
 * PowerShell single-quoted string literal.
 * @param {string} value
 * @returns {string}
 */
export function quotePowerShell(value) {
  return `'${String(value).replace(/['\u2018\u2019\u201a\u201b]/g, '$&$&')}'`;
}

/**
 * POSIX shell single-quoted string literal.
 * @param {string} value
 * @returns {string}
 */
export function quoteShell(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

/**
 * Checks that a path is relative and stays inside the root folder. Paths come
 * from the browser and do not contain such segments; the check covers the
 * case that they did.
 * @param {string} path forward-slash separated
 * @returns {boolean}
 */
export function isPlainRelativePath(path) {
  if (typeof path !== 'string' || path.length === 0) return false;
  if (path.includes('\0')) return false;
  if (path.startsWith('/') || path.startsWith('\\') || /^[a-zA-Z]:/.test(path)) return false;
  return path.split(/[\\/]/).every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

/**
 * Describes where a script has to be run, based on the loaded paths.
 * @param {string[]} paths relative paths of all loaded files
 * @returns {{ kind: 'single-folder' | 'loose-files' | 'mixed', folder: string | null, text: string }}
 */
export function describeRunLocation(paths) {
  const tops = new Set(paths.map((p) => (p.includes('/') ? p.slice(0, p.indexOf('/')) : '')));
  if (tops.size === 1 && !tops.has('')) {
    const folder = [...tops][0];
    return {
      kind: 'single-folder',
      folder,
      text: `Run the script in the folder that CONTAINS the folder "${folder}" (its parent folder), or pass that folder as the root.`,
    };
  }
  if (tops.size === 1) {
    return { kind: 'loose-files', folder: null, text: 'Run the script in the folder that contains the loaded files, or pass that folder as the root.' };
  }
  return {
    kind: 'mixed',
    folder: null,
    text: `The loaded files start in different places (${[...tops].map((t) => t || '(files without folder)').join(', ')}). Run the script in the folder that contains all of them, or pass that folder as the root.`,
  };
}

/**
 * @typedef {object} ScriptOptions
 * @property {string} [reviewFolder]
 * @property {string} [version] DupeLens version for the header
 * @property {string} [createdAt] ISO date for the header
 * @property {string} [runLocation] text from describeRunLocation
 */

function header(paths, options, commentPrefix) {
  const lines = [
    `DupeLens move script${options.version ? ` (DupeLens ${options.version})` : ''}${options.createdAt ? `, created ${options.createdAt}` : ''}`,
    '',
    `Moves ${paths.length} file${paths.length === 1 ? '' : 's'} marked "remove" into the review folder`,
    `"${options.reviewFolder ?? DEFAULT_REVIEW_FOLDER}", keeping their relative paths. The script contains`,
    'no delete commands and skips a file whose target already exists. Without the',
    'apply flag it only prints what it would do (dry run). Review the script',
    'before running it and keep a backup of your photos.',
    '',
    'Where to run it: the paths below are relative.',
    ...(options.runLocation ? wrap(sanitizeComment(options.runLocation), 74) : []),
  ];
  return lines.map((l) => (l ? `${commentPrefix} ${sanitizeComment(l)}` : commentPrefix.trimEnd()));
}

/**
 * Makes text usable inside a script comment. The run-location advice contains a
 * folder name chosen by whoever named the folder: a line break would end an sh
 * comment, and "#>" would end a PowerShell comment block, so both could turn
 * the rest of the text into commands.
 * @param {string} text
 * @returns {string}
 */
export function sanitizeComment(text) {
  return String(text)
    .replace(/[\u0000-\u001f\u007f\u0085\u2028\u2029]/g, '?')
    .replace(/#>/g, '#?')
    .replace(/<#/g, '?#');
}

function wrap(text, width) {
  const words = text.split(' ');
  const out = [];
  let line = '';
  for (const word of words) {
    if (line && line.length + 1 + word.length > width) {
      out.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) out.push(line);
  return out;
}

/**
 * PowerShell script (Windows PowerShell 5.1 and PowerShell 7). Returned with
 * CRLF line endings and to be saved with a UTF-8 byte order mark, so that
 * Windows PowerShell reads non-ASCII file names correctly.
 * @param {string[]} paths relative paths, forward slashes
 * @param {ScriptOptions} [options]
 * @returns {string}
 */
export function powerShellScript(paths, options = {}) {
  const accepted = paths.filter(isPlainRelativePath);
  const review = options.reviewFolder ?? DEFAULT_REVIEW_FOLDER;
  const lines = [
    '<#',
    ...header(accepted, options, ' '),
    '',
    '  Usage (in PowerShell, in the folder described above):',
    '    powershell -ExecutionPolicy Bypass -File .\\dupelens-move.ps1          # dry run',
    '    powershell -ExecutionPolicy Bypass -File .\\dupelens-move.ps1 -Apply   # move',
    "    ... -Root 'D:\\Photos'                     # paths are relative to this folder",
    '#>',
    '[CmdletBinding()]',
    'param(',
    '  [string]$Root = (Get-Location).ProviderPath,',
    `  [string]$ReviewFolder = ${quotePowerShell(review)},`,
    '  [switch]$Apply',
    ')',
    '',
    'Set-StrictMode -Version 2',
    "$ErrorActionPreference = 'Stop'",
    '$Root = (Resolve-Path -LiteralPath $Root).ProviderPath',
    '',
    '$files = @(',
    ...accepted.map((p) => `  ${quotePowerShell(p)}`),
    ')',
    '',
    '$pending = 0; $moved = 0; $skipped = 0; $failed = 0',
    'foreach ($relative in $files) {',
    '  $source = [System.IO.Path]::Combine($Root, $relative)',
    '  $target = [System.IO.Path]::Combine([System.IO.Path]::Combine($Root, $ReviewFolder), $relative)',
    '  if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {',
    '    Write-Warning "missing, skipped: $relative"; $skipped++; continue',
    '  }',
    '  if (Test-Path -LiteralPath $target) {',
    '    Write-Warning "already in the review folder, not overwritten: $relative"; $skipped++; continue',
    '  }',
    '  if (-not $Apply) {',
    '    Write-Output "would move: $relative"; $pending++; continue',
    '  }',
    '  try {',
    '    [void][System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($target))',
    '    [System.IO.File]::Move($source, $target)',
    '    Write-Output "moved: $relative"; $moved++',
    '  } catch {',
    '    Write-Warning "failed: $relative ($($_.Exception.Message))"; $failed++',
    '  }',
    '}',
    '',
    'if ($Apply) {',
    '  Write-Output "Done: $moved moved, $skipped skipped, $failed failed. Review folder: $([System.IO.Path]::Combine($Root, $ReviewFolder))"',
    '} else {',
    '  Write-Output "Dry run: $pending file(s) would be moved, $skipped skipped. Run again with -Apply to move them."',
    '}',
    'if ($failed -gt 0) { exit 1 }',
    '',
  ];
  return lines.join('\r\n');
}

/**
 * POSIX sh script (macOS, Linux, WSL, Git Bash). LF line endings.
 * @param {string[]} paths relative paths, forward slashes
 * @param {ScriptOptions} [options]
 * @returns {string}
 */
export function shellScript(paths, options = {}) {
  const accepted = paths.filter(isPlainRelativePath);
  const review = options.reviewFolder ?? DEFAULT_REVIEW_FOLDER;
  const lines = [
    '#!/bin/sh',
    ...header(accepted, options, '#'),
    '#',
    '# Usage (in the folder described above):',
    '#   sh dupelens-move.sh                    # dry run',
    '#   sh dupelens-move.sh --apply            # move',
    '#   sh dupelens-move.sh --root ~/Pictures  # paths are relative to this folder',
    '',
    'set -u',
    'root=.',
    `review=${quoteShell(review)}`,
    'apply=0',
    'while [ "$#" -gt 0 ]; do',
    '  case $1 in',
    '    --apply) apply=1 ;;',
    '    --root) shift; root=${1:?--root needs a folder} ;;',
    '    --review-folder) shift; review=${1:?--review-folder needs a name} ;;',
    "    -h|--help) sed -n '2,20p' \"$0\"; exit 0 ;;",
    "    *) printf 'unknown option: %s\\n' \"$1\" >&2; exit 2 ;;",
    '  esac',
    '  shift',
    'done',
    'cd -- "$root" || exit 1',
    '',
    'pending=0 moved=0 skipped=0 failed=0',
    'move_one() {',
    '  src=$1',
    '  dst=$review/$1',
    '  if [ ! -f "$src" ]; then',
    "    printf 'missing, skipped: %s\\n' \"$src\" >&2; skipped=$((skipped + 1)); return",
    '  fi',
    '  if [ -e "$dst" ] || [ -L "$dst" ]; then',
    "    printf 'already in the review folder, not overwritten: %s\\n' \"$src\" >&2; skipped=$((skipped + 1)); return",
    '  fi',
    '  if [ "$apply" -ne 1 ]; then',
    "    printf 'would move: %s\\n' \"$src\"; pending=$((pending + 1)); return",
    '  fi',
    '  # mv -i with no input does not overwrite a file that appeared in the meantime.',
    '  if mkdir -p -- "${dst%/*}" && mv -i -- "$src" "$dst" </dev/null && [ ! -e "$src" ]; then',
    "    printf 'moved: %s\\n' \"$src\"; moved=$((moved + 1))",
    '  else',
    "    printf 'failed: %s\\n' \"$src\" >&2; failed=$((failed + 1))",
    '  fi',
    '}',
    '',
    ...accepted.map((p) => `move_one ${quoteShell(p)}`),
    '',
    'if [ "$apply" -eq 1 ]; then',
    "  printf 'Done: %d moved, %d skipped, %d failed. Review folder: %s\\n' \"$moved\" \"$skipped\" \"$failed\" \"$review\"",
    'else',
    "  printf 'Dry run: %d file(s) would be moved, %d skipped. Run again with --apply to move them.\\n' \"$pending\" \"$skipped\"",
    'fi',
    '[ \"$failed\" -eq 0 ]',
    '',
  ];
  return lines.join('\n');
}
