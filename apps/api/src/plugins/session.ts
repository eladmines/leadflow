import type {} from '@fastify/cookie';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Session, User } from '@prisma/client';
import {
  AUTH_TOKEN_PATTERN,
  SESSION_ABSOLUTE_TTL_MS,
  SESSION_COOKIE_NAME,
  SESSION_IDLE_TTL_MS,
} from '@leadflow/shared';
import { AppError } from '../lib/errors';
import { sha256Hex } from '../lib/crypto';

export interface AuthState {
  user: User;
  session: Session;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** The signed-in user and session, or null when anonymous. Set by the session plugin. */
    auth: AuthState | null;
  }
  interface FastifyReply {
    setSessionCookie(token: string): FastifyReply;
    clearSessionCookie(): FastifyReply;
  }
}

/** `last_seen_at` / `expires_at` are written at most once per hour per session (D-019). */
export const SESSION_TOUCH_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Session plugin: reads the `lf_session` cookie and resolves `req.auth`.
 * - Valid = not revoked, now < expires_at, now < absolute_expires_at, user ACTIVE.
 * - Sliding: if last_seen_at is older than an hour, moves expires_at to
 *   min(now + 30 d, absolute_expires_at).
 * - A presented but invalid cookie is cleared on the response.
 *
 * Resolution runs in `preValidation`, i.e. after the CSRF guard and route rate limits
 * (both `onRequest`), so rejected requests never reach the database.
 */
export function registerSessionPlugin(app: FastifyInstance) {
  const cookieOptions = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: app.config.COOKIE_SECURE,
    path: '/',
  };

  app.decorateRequest('auth', null);

  app.decorateReply('setSessionCookie', function (this: FastifyReply, token: string) {
    return this.setCookie(SESSION_COOKIE_NAME, token, {
      ...cookieOptions,
      maxAge: Math.floor(SESSION_ABSOLUTE_TTL_MS / 1000),
    });
  });

  app.decorateReply('clearSessionCookie', function (this: FastifyReply) {
    return this.clearCookie(SESSION_COOKIE_NAME, cookieOptions);
  });

  app.addHook('preValidation', async (req, reply) => {
    req.auth = null;
    const token = req.cookies[SESSION_COOKIE_NAME];
    if (token === undefined) return;
    req.auth = await resolveSession(app, token);
    if (!req.auth) reply.clearSessionCookie();
  });
}

async function resolveSession(app: FastifyInstance, token: string): Promise<AuthState | null> {
  if (!AUTH_TOKEN_PATTERN.test(token)) return null;
  const found = await app.prisma.session.findUnique({
    where: { tokenHash: sha256Hex(token) },
    include: { user: true },
  });
  if (!found) return null;
  const now = new Date();
  const { user, ...session } = found;
  if (
    session.revokedAt !== null ||
    session.expiresAt <= now ||
    session.absoluteExpiresAt <= now ||
    user.status !== 'ACTIVE'
  ) {
    return null;
  }

  if (now.getTime() - session.lastSeenAt.getTime() > SESSION_TOUCH_INTERVAL_MS) {
    const expiresAt = new Date(
      Math.min(now.getTime() + SESSION_IDLE_TTL_MS, session.absoluteExpiresAt.getTime()),
    );
    // Conditional update: concurrent requests don't both write.
    await app.prisma.session.updateMany({
      where: { id: session.id, lastSeenAt: session.lastSeenAt },
      data: { lastSeenAt: now, expiresAt },
    });
    session.lastSeenAt = now;
    session.expiresAt = expiresAt;
  }
  return { user, session };
}

/** preHandler: 401 UNAUTHENTICATED unless the request has a valid session. */
export async function requireAuth(req: FastifyRequest) {
  if (!req.auth) throw new AppError('UNAUTHENTICATED');
}

/** Narrowing helper for handlers behind `requireAuth`. */
export function authOf(req: FastifyRequest): AuthState {
  if (!req.auth) throw new AppError('UNAUTHENTICATED');
  return req.auth;
}
