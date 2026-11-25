#!/usr/bin/env node
// Zero-dependency static server for development. Serves the repository root
// on the loopback interface only, with the same Content-Security-Policy as
// the app.
//
//   node tools/serve.mjs                    # starts the local development server
//   node tools/serve.mjs --port <number>
//   PORT=<number> node tools/serve.mjs

import { createServer } from 'node:http';
import { stat, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const CONTENT_SECURITY_POLICY =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; worker-src 'self' blob:; connect-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'; frame-ancestors 'none'";

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

/**
 * Maps a URL path to a file inside `root`, or null if it would leave it.
 * @param {string} root absolute directory
 * @param {string} urlPath
 * @returns {string | null}
 */
export function resolveInside(root, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const target = path.resolve(root, '.' + path.posix.normalize('/' + decoded));
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return target;
}

/**
 * @param {string} root
 */
export function createDevServer(root) {
  return createServer(async (request, response) => {
    const send = (status, body, type = 'text/plain; charset=utf-8') => {
      response.writeHead(status, {
        'Content-Type': type,
        'Content-Security-Policy': CONTENT_SECURITY_POLICY,
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Cache-Control': 'no-store',
      });
      response.end(body);
    };
    if (request.method !== 'GET' && request.method !== 'HEAD') return send(405, 'Method not allowed');
    let file = resolveInside(root, request.url || '/');
    if (!file) return send(403, 'Forbidden');
    try {
      let info = await stat(file);
      if (info.isDirectory()) {
        file = path.join(file, 'index.html');
        info = await stat(file);
      }
      const body = request.method === 'HEAD' ? '' : await readFile(file);
      send(200, body, MIME_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream');
    } catch {
      send(404, 'Not found');
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const portIndex = process.argv.indexOf('--port');
  const port = Number(portIndex >= 0 ? process.argv[portIndex + 1] : process.env.PORT || 8080);
  const server = createDevServer(root);
  server.listen(port, '127.0.0.1', () => {
    console.log(`DupeLens development server: http://127.0.0.1:${port}/`);
    console.log('Press Ctrl+C to stop.');
  });
}
