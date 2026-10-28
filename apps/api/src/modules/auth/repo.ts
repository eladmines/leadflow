import type { AuthTokenType, User } from '@prisma/client';
import type { Db } from '../../lib/db';

/**
 * Users, sessions and auth tokens are platform-level (not tenant-owned), so these queries
 * take no TenantContext. Every function accepts a Prisma client or a transaction client.
 */

export function findUserByEmail(db: Db, email: string): Promise<User | null> {
  return db.user.findUnique({ where: { email } });
}

export function createUser(
  db: Db,
  data: { email: string; passwordHash: string; fullName: string },
): Promise<User> {
  return db.user.create({ data });
}

export function createSession(
  db: Db,
  data: {
    userId: string;
    tokenHash: string;
    now: Date;
    expiresAt: Date;
    absoluteExpiresAt: Date;
    ip: string | null;
    userAgent: string | null;
  },
) {
  const { now, ...rest } = data;
  return db.session.create({ data: { ...rest, lastSeenAt: now, createdAt: now } });
}

/** Revokes one session if it isn't already revoked. Returns the number of rows changed. */
export async function revokeSession(db: Db, sessionId: string, now: Date): Promise<number> {
  const res = await db.session.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: now },
  });
  return res.count;
}

/** Revokes every live session of a user. Returns how many were revoked. */
export async function revokeAllSessions(db: Db, userId: string, now: Date): Promise<number> {
  const res = await db.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: now },
  });
  return res.count;
}

export function createAuthToken(
  db: Db,
  data: { userId: string; type: AuthTokenType; tokenHash: string; expiresAt: Date },
) {
  return db.authToken.create({ data });
}

export function findAuthTokenByHash(db: Db, tokenHash: string) {
  return db.authToken.findUnique({ where: { tokenHash }, include: { user: true } });
}

/**
 * Marks one token used, only if it is still unused. Returns false when another request
 * consumed it first (single use under concurrency).
 */
export async function consumeAuthToken(db: Db, tokenId: string, now: Date): Promise<boolean> {
  const res = await db.authToken.updateMany({
    where: { id: tokenId, usedAt: null },
    data: { usedAt: now },
  });
  return res.count === 1;
}

/** Marks every unused token of a type used (supersede / consume all). */
export async function markUnusedTokensUsed(
  db: Db,
  userId: string,
  type: AuthTokenType,
  now: Date,
): Promise<number> {
  const res = await db.authToken.updateMany({
    where: { userId, type, usedAt: null },
    data: { usedAt: now },
  });
  return res.count;
}

export function markEmailVerified(db: Db, userId: string, now: Date) {
  return db.user.updateMany({
    where: { id: userId, emailVerifiedAt: null },
    data: { emailVerifiedAt: now },
  });
}

export function updatePasswordHash(db: Db, userId: string, passwordHash: string) {
  return db.user.update({ where: { id: userId }, data: { passwordHash } });
}

/** Revokes every active session of the user except `keepSessionId` (password change). */
export async function revokeOtherSessions(
  db: Db,
  userId: string,
  keepSessionId: string,
  now: Date,
) {
  const res = await db.session.updateMany({
    where: { userId, revokedAt: null, id: { not: keepSessionId } },
    data: { revokedAt: now },
  });
  return res.count;
}

export function updateFullName(db: Db, userId: string, fullName: string) {
  return db.user.update({ where: { id: userId }, data: { fullName } });
}
