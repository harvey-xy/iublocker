/**
 * Static fixture server for the e2e suite (docs/TESTING.md §E2E).
 *
 * Binds 127.0.0.1 on a random free port and serves:
 *   /<name>.html        the pages in e2e/fixtures/pages/
 *   /ads/banner.js      sets `window.__ad = true`            (blocked by the e2e list)
 *   /ads/gpt.js         sets `window.__gptLoaded = true`     (redirected to a surrogate)
 *   /ads/frame.html     an iframe document                   (blocked)
 *   /track/pixel.gif    a real 1x1 GIF                        (blocked)
 *   /track/ping         204, for navigator.sendBeacon/fetch   (blocked)
 *   /api/data.json      a normal XHR endpoint                 (never blocked)
 *   /__hits             JSON counter of requests per path; DELETE or /__hits/reset clears
 *
 * 127.0.0.1 is the host `e2e/fixtures/test-list.txt` targets, so anything under /ads/ or
 * /track/ must be blocked by the extension and everything else must load.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGES_DIR = path.join(HERE, 'fixtures', 'pages');

/** 1x1 transparent GIF. */
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.gif': 'image/gif',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

export interface FixtureServer {
  /** e.g. http://127.0.0.1:38411 */
  origin: string;
  port: number;
  /** Absolute URL for a path such as `/network.html`. */
  url(pathname: string): string;
  /** Request counts per pathname, as seen by the server (blocked requests never arrive). */
  hits(): Record<string, number>;
  hitsFor(pathname: string): number;
  resetHits(): void;
  close(): Promise<void>;
}

function noStore(res: ServerResponse): void {
  res.setHeader('cache-control', 'no-store, no-cache, must-revalidate');
  res.setHeader('pragma', 'no-cache');
}

export async function startServer(): Promise<FixtureServer> {
  const counters = new Map<string, number>();

  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const pathname = url.pathname;
    noStore(res);

    if (pathname !== '/__hits' && pathname !== '/__hits/reset') {
      counters.set(pathname, (counters.get(pathname) ?? 0) + 1);
    }

    if (pathname === '/__hits') {
      if (req.method === 'DELETE') counters.clear();
      res.writeHead(200, {
        'content-type': CONTENT_TYPES['.json'] as string,
        'access-control-allow-origin': '*',
      });
      res.end(JSON.stringify(Object.fromEntries(counters)));
      return;
    }
    if (pathname === '/__hits/reset') {
      counters.clear();
      res.writeHead(204, { 'access-control-allow-origin': '*' });
      res.end();
      return;
    }

    switch (pathname) {
      case '/ads/banner.js':
        res.writeHead(200, { 'content-type': CONTENT_TYPES['.js'] as string });
        res.end('window.__ad = true;\n');
        return;
      case '/ads/gpt.js':
        res.writeHead(200, { 'content-type': CONTENT_TYPES['.js'] as string });
        res.end('window.__gptLoaded = true;\n');
        return;
      case '/ads/frame.html':
        res.writeHead(200, { 'content-type': CONTENT_TYPES['.html'] as string });
        res.end(
          '<!doctype html><html><body><p id="ad-frame">AD FRAME</p><script>window.__adFrame = true;</script></body></html>',
        );
        return;
      case '/track/pixel.gif':
        res.writeHead(200, { 'content-type': 'image/gif', 'content-length': String(PIXEL.length) });
        res.end(PIXEL);
        return;
      case '/track/ping':
        res.writeHead(204);
        res.end();
        return;
      case '/api/data.json':
        res.writeHead(200, { 'content-type': CONTENT_TYPES['.json'] as string });
        res.end(JSON.stringify({ ok: true, items: [1, 2, 3] }));
        return;
      case '/favicon.ico':
        res.writeHead(204);
        res.end();
        return;
      default:
        break;
    }

    // Everything else comes from e2e/fixtures/pages (flat, no directories).
    const name = pathname === '/' ? 'index.html' : pathname.slice(1);
    if (name.includes('/') || name.includes('..')) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
      return;
    }
    try {
      const body = await readFile(path.join(PAGES_DIR, name));
      res.writeHead(200, { 'content-type': CONTENT_TYPES[path.extname(name)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end(`not found: ${name}`);
    }
  };

  const server: Server = createServer((req, res) => {
    handler(req, res).catch((err: unknown) => {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end(String(err));
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const { port } = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${port}`;

  return {
    origin,
    port,
    url: (pathname: string) => new URL(pathname, origin).href,
    hits: () => Object.fromEntries(counters),
    hitsFor: (pathname: string) => counters.get(pathname) ?? 0,
    resetHits: () => counters.clear(),
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
        server.closeAllConnections?.();
      }),
  };
}
