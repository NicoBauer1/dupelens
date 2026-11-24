// Collects files from the file picker, the folder picker and drag and drop
// (including dropped folders), together with their relative paths.

/**
 * @typedef {object} LoadedFile
 * @property {File} file
 * @property {string} path relative path with forward slashes, e.g. "Trip/IMG_1.jpg"
 */

/**
 * Files from an <input type="file"> (with or without webkitdirectory).
 * @param {FileList | File[]} list
 * @returns {LoadedFile[]}
 */
export function filesFromInput(list) {
  return Array.from(list, (file) => ({ file, path: normalisePath(file.webkitRelativePath || file.name) }));
}

/**
 * @param {string} path
 * @returns {string}
 */
export function normalisePath(path) {
  return path.replace(/\\/g, '/').replace(/^\/+/, '');
}

/**
 * Reads all entries of a directory; readEntries returns them in batches.
 * @param {FileSystemDirectoryEntry} directory
 * @returns {Promise<FileSystemEntry[]>}
 */
function readAllEntries(directory) {
  const reader = directory.createReader();
  const entries = [];
  return new Promise((resolve, reject) => {
    const readBatch = () => {
      reader.readEntries((batch) => {
        if (batch.length === 0) resolve(entries);
        else {
          entries.push(...batch);
          readBatch();
        }
      }, reject);
    };
    readBatch();
  });
}

/**
 * @param {FileSystemEntry} entry
 * @param {LoadedFile[]} out
 * @param {(count: number) => void} [onProgress]
 */
async function walk(entry, out, onProgress) {
  if (entry.isFile) {
    const file = await new Promise((resolve, reject) => /** @type {FileSystemFileEntry} */ (entry).file(resolve, reject));
    out.push({ file, path: normalisePath(entry.fullPath || file.name) });
    if (onProgress && out.length % 100 === 0) onProgress(out.length);
  } else if (entry.isDirectory) {
    const children = await readAllEntries(/** @type {FileSystemDirectoryEntry} */ (entry));
    children.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const child of children) await walk(child, out, onProgress);
  }
}

/**
 * Files from a drop event. Folders are traversed recursively when the
 * browser supports webkitGetAsEntry (all current browsers do).
 * @param {DataTransfer} dataTransfer
 * @param {(count: number) => void} [onProgress]
 * @returns {Promise<LoadedFile[]>}
 */
export async function filesFromDrop(dataTransfer, onProgress) {
  const items = Array.from(dataTransfer.items || []);
  const entries = items
    .filter((item) => item.kind === 'file')
    .map((item) => (typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null));
  if (entries.length && entries.every(Boolean)) {
    const out = [];
    for (const entry of entries) await walk(entry, out, onProgress);
    return out;
  }
  return filesFromInput(dataTransfer.files);
}
