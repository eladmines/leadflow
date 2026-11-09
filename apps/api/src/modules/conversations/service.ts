import type { Prisma, PrismaClient } from '@prisma/client';
import {
  CONVERSATIONS_PAGE,
  WHATSAPP_WINDOW_MS,
  type ConversationListResponse,
  type ConversationResponse,
  type ConversationSummary,
  type WhatsAppMessage,
} from '@leadflow/shared';
import type { z } from 'zod';
import type { conversationListQuerySchema } from '@leadflow/shared';
import { AppError } from '../../lib/errors';
import type { TenantContext } from '../../plugins/tenant';
import { toDto, type WhatsAppService } from '../whatsapp/service';

type ListQuery = z.output<typeof conversationListQuerySchema>;

const sender = { select: { id: true, fullName: true } } as const;
const include = {
  messages: {
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: { body: true, direction: true, createdAt: true },
  },
  contact: { select: { id: true, name: true } },
} satisfies Prisma.WhatsAppNumberInclude;
type NumberRow = Prisma.WhatsAppNumberGetPayload<{ include: typeof include }>;

/**
 * F24 unified inbox (D-158). A conversation is one sender on one channel (the channel-aware
 * `whatsapp_numbers` row); its last-message time and unread flag are kept by a database trigger.
 * Personal numbers never appear. Sending and classifying reuse the WhatsApp service.
 */
export class ConversationService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly whatsapp: WhatsAppService,
  ) {}

  private visible(businessId: string): Prisma.WhatsAppNumberWhereInput {
    return {
      businessId,
      status: { in: ['UNCLASSIFIED', 'BUSINESS'] },
      lastMessageAt: { not: null },
    };
  }

  async list(ctx: TenantContext, q: ListQuery): Promise<ConversationListResponse> {
    const where: Prisma.WhatsAppNumberWhereInput = {
      ...this.visible(ctx.businessId),
      ...(q.channel ? { channel: q.channel } : {}),
      ...(q.filter === 'unread' ? { unread: true } : {}),
      ...(q.filter === 'new' ? { status: 'UNCLASSIFIED' } : {}),
    };
    if (q.cursor) {
      const [ms, id] = q.cursor.split('_') as [string, string];
      const at = new Date(Number(ms));
      where.OR = [{ lastMessageAt: { lt: at } }, { lastMessageAt: at, id: { lt: id } }];
    }
    const [rows, unreadCount] = await Promise.all([
      this.prisma.whatsAppNumber.findMany({
        where,
        include,
        orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
        take: CONVERSATIONS_PAGE + 1,
      }),
      this.unreadCount(ctx),
    ]);
    const page = rows.slice(0, CONVERSATIONS_PAGE);
    const last = page.at(-1);
    return {
      connected: this.whatsapp.connectedTo(ctx.businessId),
      conversations: await this.summaries(ctx.businessId, page),
      nextCursor:
        rows.length > CONVERSATIONS_PAGE && last
          ? `${last.lastMessageAt!.getTime()}_${last.id}`
          : null,
      unreadCount,
    };
  }

  unreadCount(ctx: TenantContext) {
    return this.prisma.whatsAppNumber.count({
      where: { ...this.visible(ctx.businessId), unread: true },
    });
  }

  async detail(ctx: TenantContext, id: string): Promise<ConversationResponse> {
    const number = await this.require(ctx, id);
    const rows = await this.prisma.whatsAppMessage.findMany({
      where: { numberId: number.id },
      include: { sender },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const lastIn = rows.find((r) => r.direction === 'IN');
    const until = lastIn ? lastIn.createdAt.getTime() + WHATSAPP_WINDOW_MS : 0;
    const [conversation] = await this.summaries(ctx.businessId, [number]);
    return {
      conversation: conversation!,
      messages: rows.reverse().map((r) => toDto(r, number.channel)),
      replyUntil: until > Date.now() ? new Date(until).toISOString() : null,
    };
  }

  /** Opened by someone on the team: read for everyone. */
  async markRead(ctx: TenantContext, id: string): Promise<void> {
    const number = await this.require(ctx, id);
    if (number.unread) {
      await this.prisma.whatsAppNumber.update({
        where: { id: number.id },
        data: { unread: false },
      });
    }
  }

  /** A reply through the conversation's channel; answering it also marks it read. */
  async send(
    ctx: TenantContext,
    id: string,
    text: string,
  ): Promise<{ message: WhatsAppMessage; leadId: string | null }> {
    await this.require(ctx, id);
    const sent = await this.whatsapp.sendOnNumber(ctx, id, text);
    await this.prisma.whatsAppNumber.update({ where: { id }, data: { unread: false } });
    return sent;
  }

  private async require(ctx: TenantContext, id: string) {
    const number = /^[0-9a-f-]{36}$/i.test(id)
      ? await this.prisma.whatsAppNumber.findFirst({
          where: { id, ...this.visible(ctx.businessId) },
          include,
        })
      : null;
    if (!number) throw new AppError('NOT_FOUND');
    return number;
  }

  /**
   * The list rows: who (contact name for customers, else the profile name), the lead to open,
   * and the last message. WhatsApp customers are matched to contacts by phone, Facebook ones by
   * their link (F23).
   */
  private async summaries(businessId: string, rows: NumberRow[]): Promise<ConversationSummary[]> {
    const phones = rows
      .filter((r) => r.channel === 'whatsapp' && r.status === 'BUSINESS')
      .map((r) => r.phone);
    const byPhone = new Map(
      (phones.length
        ? await this.prisma.contact.findMany({
            where: { businessId, phone: { in: phones } },
            orderBy: { createdAt: 'asc' },
            select: { id: true, name: true, phone: true },
          })
        : []
      )
        .reverse()
        .map((c) => [c.phone!, c] as const),
    );
    const contactOf = (r: NumberRow) =>
      r.channel === 'messenger' ? r.contact : (byPhone.get(r.phone) ?? null);
    const contactIds = [
      ...new Set(
        rows
          .map(contactOf)
          .filter(Boolean)
          .map((c) => c!.id),
      ),
    ];
    const leads = contactIds.length
      ? await this.prisma.lead.findMany({
          where: { businessId, contactId: { in: contactIds } },
          orderBy: { createdAt: 'desc' },
          select: { id: true, contactId: true, stage: { select: { kind: true } } },
        })
      : [];
    const leadOf = (contactId: string) =>
      (
        leads.find((l) => l.contactId === contactId && l.stage.kind === 'OPEN') ??
        leads.find((l) => l.contactId === contactId)
      )?.id ?? null;

    return rows.map((r) => {
      const contact = r.status === 'BUSINESS' ? contactOf(r) : null;
      const last = r.messages[0];
      return {
        id: r.id,
        channel: r.channel === 'messenger' ? 'messenger' : 'whatsapp',
        status: r.status === 'UNCLASSIFIED' ? 'UNCLASSIFIED' : 'BUSINESS',
        name: contact?.name ?? r.profileName ?? null,
        phone: r.channel === 'whatsapp' ? r.phone : null,
        leadId: contact ? leadOf(contact.id) : null,
        lastMessage: last
          ? {
              body: last.body.slice(0, 200),
              direction: last.direction,
              at: last.createdAt.toISOString(),
            }
          : null,
        lastMessageAt: (r.lastMessageAt ?? r.createdAt).toISOString(),
        unread: r.unread,
      };
    });
  }
}
