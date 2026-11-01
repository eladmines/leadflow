import type { MembershipRole, Prisma, PrismaClient } from '@prisma/client';
import {
  NOTIFICATION_TYPES,
  type Notification,
  type NotificationListResponse,
  type NotificationType,
} from '@leadflow/shared';
import type { Db } from '../../lib/db';
import type { TenantContext } from '../../plugins/tenant';

/** Who gets a notification: members with these roles, plus specific users (e.g. the lead owner). */
export interface Recipients {
  roles?: MembershipRole[];
  userIds?: (string | null | undefined)[];
}

/** Owners and managers: they see every lead (`leads.view.all`). */
export const MANAGERS: MembershipRole[] = ['OWNER', 'MANAGER'];

/**
 * Creates one notification per active member among the recipients (D-097). Only members of the
 * business are notified, whatever ids are passed in.
 */
export async function notify(
  db: Db,
  input: {
    businessId: string;
    type: NotificationType;
    data: Prisma.InputJsonObject;
    to: Recipients;
    /** Don't notify the person who caused it. */
    exceptUserId?: string | null;
  },
): Promise<number> {
  const ids = (input.to.userIds ?? []).filter((x): x is string => Boolean(x));
  const members = await db.membership.findMany({
    where: {
      businessId: input.businessId,
      status: 'ACTIVE',
      user: { status: 'ACTIVE' },
      OR: [
        ...(input.to.roles?.length ? [{ role: { in: input.to.roles } }] : []),
        ...(ids.length ? [{ userId: { in: ids } }] : []),
      ],
    },
    select: { userId: true },
  });
  const userIds = [...new Set(members.map((m) => m.userId))].filter(
    (id) => id !== input.exceptUserId,
  );
  if (userIds.length === 0) return 0;
  const { count } = await db.notification.createMany({
    data: userIds.map((userId) => ({
      businessId: input.businessId,
      userId,
      type: input.type,
      data: input.data,
    })),
  });
  return count;
}

/** Best effort: a failed notification never breaks the action that caused it. */
export async function notifySafe(
  db: Db,
  log: { error: (obj: object, msg: string) => void },
  input: Parameters<typeof notify>[1],
): Promise<void> {
  try {
    await notify(db, input);
  } catch (err) {
    log.error({ errName: (err as Error)?.name, type: input.type }, 'notification failed');
  }
}

const LIST_SIZE = 30;

export class NotificationService {
  constructor(private readonly prisma: PrismaClient) {}

  /** The caller's latest notifications in this business and how many are unread. */
  async list(ctx: TenantContext): Promise<NotificationListResponse> {
    const mine = { businessId: ctx.businessId, userId: ctx.userId };
    const [rows, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where: mine,
        orderBy: { createdAt: 'desc' },
        take: LIST_SIZE,
      }),
      this.prisma.notification.count({ where: { ...mine, readAt: null } }),
    ]);
    return {
      notifications: rows
        .filter((r) => (NOTIFICATION_TYPES as readonly string[]).includes(r.type))
        .map((r): Notification => ({
          id: r.id,
          type: r.type as NotificationType,
          data: (r.data ?? {}) as Record<string, unknown>,
          readAt: r.readAt?.toISOString() ?? null,
          createdAt: r.createdAt.toISOString(),
        })),
      unreadCount,
    };
  }

  /** Marks the caller's notifications read (these ids, or all of them). */
  async markRead(ctx: TenantContext, ids?: string[]): Promise<void> {
    await this.prisma.notification.updateMany({
      where: {
        businessId: ctx.businessId,
        userId: ctx.userId,
        readAt: null,
        ...(ids ? { id: { in: ids } } : {}),
      },
      data: { readAt: new Date() },
    });
  }
}
