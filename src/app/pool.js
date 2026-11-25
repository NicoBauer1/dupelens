// A small pool of analysis workers with a main-thread fallback.
//
// The pool size follows navigator.hardwareConcurrency (one core is left for
// the page, at most 8 workers). Every worker must answer a ping within a few
// seconds and confirm that it can decode images (OffscreenCanvas); otherwise
// — for example when a browser refuses workers created from Blob URLs on
// file:// pages — the files are analysed on the main thread instead, one at a
// time, with a pause between files so the page stays responsive.

import { analyseFile, canDecodeHere } from './analyse-file.js';
import { createAnalysisWorker } from './worker-factory.js';

const PING_TIMEOUT_MS = 4000;

/**
 * @param {Worker} worker
 * @returns {Promise<boolean>} true if the worker answered and can decode
 */
function pingWorker(worker) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), PING_TIMEOUT_MS);
    worker.addEventListener('message', function onMessage(event) {
      if (event.data && event.data.type === 'pong') {
        clearTimeout(timer);
        worker.removeEventListener('message', onMessage);
        resolve(Boolean(event.data.canDecode));
      }
    });
    worker.addEventListener('error', () => {
      clearTimeout(timer);
      resolve(false);
    }, { once: true });
    worker.postMessage({ type: 'ping' });
  });
}

/** Number of workers to start on this device. */
export function poolSize() {
  const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2;
  return Math.max(1, Math.min(8, cores - 1));
}

export class AnalysisPool {
  constructor() {
    /** @type {Worker[]} */
    this.workers = [];
    /** 'workers' | 'main-thread' */
    this.mode = 'main-thread';
    this.reason = '';
    this.nextId = 1;
    /** @type {Map<number, { resolve: Function, reject: Function }>} */
    this.pending = new Map();
  }

  /**
   * Starts the workers and checks that they work.
   * @param {{ forceMainThread?: boolean }} [options] `forceMainThread` skips
   *   the workers (used to test the fallback, e.g. with ?workers=0)
   * @returns {Promise<AnalysisPool>}
   */
  async start(options = {}) {
    if (options.forceMainThread) return this.useMainThread('Workers are switched off (?workers=0).');
    const size = poolSize();
    const candidates = [];
    try {
      for (let i = 0; i < size; i++) candidates.push(createAnalysisWorker());
    } catch (error) {
      candidates.forEach((w) => w.terminate());
      return this.useMainThread(`Workers could not be started (${error && error.message ? error.message : error}).`);
    }
    const ok = await pingWorker(candidates[0]);
    if (!ok) {
      candidates.forEach((w) => w.terminate());
      return this.useMainThread('Workers are not available or do not decode images here.');
    }
    const rest = await Promise.all(candidates.slice(1).map(pingWorker));
    this.workers = candidates.filter((w, i) => i === 0 || rest[i - 1]);
    candidates.filter((w) => !this.workers.includes(w)).forEach((w) => w.terminate());
    for (const worker of this.workers) {
      worker.addEventListener('message', (event) => this.onMessage(event.data));
    }
    this.mode = 'workers';
    this.reason = `${this.workers.length} worker${this.workers.length === 1 ? '' : 's'}`;
    return this;
  }

  /** @param {string} reason */
  useMainThread(reason) {
    this.mode = 'main-thread';
    this.reason = reason;
    if (!canDecodeHere()) throw new Error('This browser does not decode images to pixels (createImageBitmap and canvas are required).');
    return this;
  }

  onMessage(message) {
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (message.type === 'result') pending.resolve(message.result);
    else pending.reject(new Error(message.message));
  }

  /**
   * Analyses files with all workers in parallel.
   * @param {Array<{ file: File, name: string }>} jobs
   * @param {(index: number, result: import('./analyse-file.js').AnalysisResult | null, error?: Error) => void} onResult
   * @param {{ cancelled: boolean }} [signal]
   */
  async run(jobs, onResult, signal = { cancelled: false }) {
    let next = 0;
    if (this.mode === 'main-thread') {
      while (next < jobs.length && !signal.cancelled) {
        const index = next++;
        try {
          onResult(index, await analyseFile(jobs[index].file, jobs[index].name));
        } catch (error) {
          onResult(index, null, error);
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      return;
    }
    // Two jobs in flight per worker hide the time spent reading files.
    const lanes = this.workers.flatMap((worker) => [worker, worker]);
    await Promise.all(
      lanes.map(async (worker) => {
        while (next < jobs.length && !signal.cancelled) {
          const index = next++;
          const id = this.nextId++;
          const promise = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
          worker.postMessage({ type: 'analyse', id, file: jobs[index].file, name: jobs[index].name });
          try {
            onResult(index, await promise);
          } catch (error) {
            onResult(index, null, error);
          }
        }
      }),
    );
  }

  terminate() {
    this.workers.forEach((w) => w.terminate());
    this.workers = [];
  }
}
