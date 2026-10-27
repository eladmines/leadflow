import type { FastifyInstance } from 'fastify';
import { CSRF_HEADER_NAME } from '@leadflow/shared';
import { AppError } from '../lib/errors';

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const HEADER = CSRF_HEADER_NAME.toLowerCase();

/**
 * CSRF guard for every state-changing request (authenticated or not):
 * `X-Requested-With` must be present and non-empty, and `Origin`, if present, must be one of
 * `WEB_ORIGINS`. Otherwise 403 FORBIDDEN. Runs in `onRequest`, before auth and body validation.
 */
export function registerCsrfGuard(app: FastifyInstance) {
  const allowed = new Set(app.config.WEB_ORIGINS);
  app.addHook('onRequest', async (req) => {
    if (!STATE_CHANGING.has(req.method)) return;
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
