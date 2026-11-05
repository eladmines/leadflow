import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyReply, FastifyRequest } from 'fastify';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

/**
 * Serves the built web app (apps/web/dist) from the API's own port (D-119), so one service hosts
 * everything and the session cookie stays same-origin. Real files are sent as they are (hashed
 * `/assets/*` cached for a year); any other page path gets index.html for the client router.
 * Returns false for requests it doesn't own (the API's JSON 404 answers those).
 */
export function createWebAppHandler(dir: string) {
  const root = path.resolve(dir);
  const index = path.join(root, 'index.html');

  return async (req: FastifyRequest, reply: FastifyReply): Promise<boolean> => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    const urlPath = decodeURIComponent(req.url.split('?')[0]!);
    if (urlPath.startsWith('/api/') || urlPath.startsWith('/media/')) return false;

    const file = path.resolve(root, `.${urlPath}`);
    const inside = file === root || file.startsWith(root + path.sep);
    const isFile = inside && (await stat(file).catch(() => null))?.isFile();
    const target = isFile ? file : index;
    // A missing asset is a real 404, not the app shell (a stale tab after a deploy).
    if (!isFile && urlPath.startsWith('/assets/')) return false;

    const body = await readFile(target);
    reply
      .status(200)
      .header('content-type', TYPES[path.extname(target)] ?? 'application/octet-stream')
      .header(
        'cache-control',
        isFile && urlPath.startsWith('/assets/')
          ? 'public, max-age=31536000, immutable'
          : 'no-cache',
      )
      .header('x-content-type-options', 'nosniff')
      .header('referrer-policy', 'strict-origin-when-cross-origin')
      .header('x-frame-options', 'DENY')
      .send(body);
    return true;
  };
}
