import type { FastifyInstance } from 'fastify';
import { apiPaths, CSRF_HEADER_NAME, emailInboundPath } from '@leadflow/shared';
import { AppError } from '../lib/errors';

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const HEADER = CSRF_HEADER_NAME.toLowerCase();
/** Server-to-server webhooks: no cookies, authenticated by the sender's signature instead. */
const EXEMPT = new Set<string>([
  apiPaths.whatsapp.webhook,
  apiPaths.whatsapp.messengerWebhook,
  emailInboundPath,
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
