// Starts a headless Chromium-based browser (Chrome, Edge or Chromium) with a
// throw-away profile and talks to it over the DevTools protocol with Node's
// built-in WebSocket. Used by the smoke test and the screenshot tool; no
// dependencies.

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const CANDIDATES = {
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ],
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ],
  linux: ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge'],
};

/** Path of the browser: $BROWSER or the first installed candidate. */
export async function findBrowser() {
  if (process.env.BROWSER) return process.env.BROWSER;
  for (const candidate of CANDIDATES[process.platform] || []) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // try the next one
    }
  }
  throw new Error('No Chromium-based browser found; set BROWSER=/path/to/browser');
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Polls `check` until it returns a truthy value.
 * @template T
 * @param {() => Promise<T> | T} check
 * @param {number} timeout milliseconds
 * @param {string} what for the error message
 * @returns {Promise<T>}
 */
export async function waitFor(check, timeout, what) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await check();
    if (value) return value;
    await sleep(200);
  }
  throw new Error(`timed out waiting for ${what}`);
}

class Connection {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = [];
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(`${message.error.message} (${message.error.code})`));
        else resolve(message.result);
      } else if (message.method) {
        for (const listener of this.listeners) listener(message);
      }
    });
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    this.socket.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
}

/**
 * Launches the browser and opens one page.
 * @param {{ width?: number, height?: number }} [options] window size
 */
export async function launchBrowser({ width = 1400, height = 1000 } = {}) {
  const browserPath = await findBrowser();
  const profile = await mkdtemp(path.join(tmpdir(), 'dupelens-browser-'));
  const child = spawn(browserPath, [
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-sync',
    `--user-data-dir=${profile}`,
    '--remote-debugging-port=0',
    `--window-size=${width},${height}`,
    // CI containers often lack the user namespaces Chrome's sandbox needs.
    ...(process.env.CI ? ['--no-sandbox'] : []),
    'about:blank',
  ], { stdio: 'ignore' });

  const close = async () => {
    child.kill();
    await sleep(500);
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  };

  try {
    const portFile = path.join(profile, 'DevToolsActivePort');
    const portText = await waitFor(() => readFile(portFile, 'utf8').catch(() => ''), 20000, 'the browser to start');
    const [port, wsPath] = portText.trim().split('\n');
    const socket = new WebSocket(`ws://127.0.0.1:${port}${wsPath}`);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    const connection = new Connection(socket);
    const { targetId } = await connection.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await connection.send('Target.attachToTarget', { targetId, flatten: true });
    const send = (method, params) => connection.send(method, params, sessionId);
    const evaluate = async (expression) => {
      const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
      return result.value;
    };
    /** Events of this page only. */
    const onEvent = (listener) => connection.listeners.push((message) => {
      if (message.sessionId === sessionId) listener(message);
    });
    return {
      profile,
      send,
      /** Browser-level command (not tied to the page). */
      sendBrowser: (method, params) => connection.send(method, params),
      evaluate,
      onEvent,
      close: async () => {
        socket.close();
        await close();
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}
