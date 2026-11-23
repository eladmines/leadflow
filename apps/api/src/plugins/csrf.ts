import type { FastifyInstance } from 'fastify';
import { apiPaths, CSRF_HEADER_NAME, emailInboundPath } from '@simplecatch/shared';
import { AppError } from '../lib/errors';

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const HEADER = CSRF_HEADER_NAME.toLowerCase();
/** Webhooks and public forms: no cookies, authenticated by a signature or key instead. */
const EXEMPT = new Set<string>([
  apiPaths.whatsapp.webhook,
  apiPaths.whatsapp.messengerWebhook,
  emailInboundPath,
  // F30: forms on other people's websites post here (no cookies; the business key authorizes it).
  apiPaths.embed.lead,
]);

/**
 * CSRF guard for every state-changing request (authenticated or not):
 * `X-Requested-With` must be present and non-empty, and `Origin`, if present, must be one of
 * `WEB_ORIGINS`. Otherwise 403 FORBIDDEN. Runs in `onRequest`, before auth and body validation.
 * Signed webhooks (`EXEMPT`) skip it; they never read the session cookie.
 */
export function registerCsrfGuard(app: FastifyInstance) {
  const allowed = new Set(app.config.WEB_ORIGINS);
  app.addHook('onRequest', async (req) => {
    if (!STATE_CHANGING.has(req.method)) return;
    if (EXEMPT.has(req.url.split('?')[0]!)) return;
    const marker = req.headers[HEADER];
    if (typeof marker !== 'string' || marker.trim() === '') {
      throw new AppError('FORBIDDEN');
    }
    const origin = req.headers.origin;
    if (origin !== undefined && !allowed.has(origin)) {
      throw new AppError('FORBIDDEN');
    }
  });
}
