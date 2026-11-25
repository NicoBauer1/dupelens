// Development build: the worker is loaded as an ES module next to this file.
// The single-file build replaces this module with one that starts the worker
// from a Blob URL (see tools/build.mjs).

export function createAnalysisWorker() {
  return new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
}
