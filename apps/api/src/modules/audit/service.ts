import type { Prisma } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../../lib/db';

export interface AuditEntry {
  action: string;
  /** Null for platform-level events (auth). Always set for tenant events (F02+). */
  businessId?: string | null;
  actorUserId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  /** Never put passwords, tokens, hashes, cookies or a failed login's email here. */
  metadata?: Prisma.InputJsonObject;
}

/** Writes one audit row. Throws on failure; use inside a transaction when it must be atomic. */
export async function recordAudit(db: Db, entry: AuditEntry): Promise<void> {
  await db.auditLog.create({
    data: {
      action: entry.action,
      businessId: entry.businessId ?? null,
      actorUserId: entry.actorUserId ?? null,
      entityType: entry.entityType ?? null,
      entityId: entry.entityId ?? null,
      metadata: entry.metadata ?? {},
    },
  });
}

/**
 * Best-effort audit: a failure is logged (action only) and never changes the response.
 */
export async function recordAuditSafe(
  db: Db,
  log: FastifyBaseLogger,
  entry: AuditEntry,
): Promise<void> {
  try {
    await recordAudit(db, entry);
  } catch (err) {
    log.error({ action: entry.action, errName: (err as Error)?.name }, 'audit write failed');
  }
}
