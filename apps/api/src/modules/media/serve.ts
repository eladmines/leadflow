import type { FastifyInstance } from 'fastify';
import { MEDIA_PATH } from '@leadflow/shared';
import { STORAGE_KEY, type StorageProvider } from '../../integrations/storage';

/**
 * Serves stored images at `/media/<key>` (same origin as the page, so a strict CSP still allows
 * them). Keys are immutable, so responses are cached for a year.
 */
export function registerMediaServing(app: FastifyInstance, storage: StorageProvider) {
  app.get(`${MEDIA_PATH}/*`, async (req, reply) => {
    const key = (req.params as { '*': string })['*'];
    const body = STORAGE_KEY.test(key) ? await storage.get(key) : null;
    if (!body)
      return reply
        .status(404)
        .header('cache-control', 'no-store')
        .type('text/plain')
        .send('Not found');
    return reply
      .header('content-type', 'image/webp')
      .header('cache-control', 'public, max-age=31536000, immutable')
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', "default-src 'none'")
      .send(body);
  });
}
