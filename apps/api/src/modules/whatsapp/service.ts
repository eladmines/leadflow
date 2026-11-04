import { Prisma, type PrismaClient, type WhatsAppMessage as MessageRow } from '@prisma/client';
import {
  BOT_FLOWS,
  botDefaultTextsFor,
  botFlowFor,
  botShowcaseSchema,
  type BotFlow,
  botTextsSchema,
  showcaseDefaultText,
  showcaseMessages,
  formatIsraeliPhone,
  WHATSAPP_STATUSES,
  WHATSAPP_WINDOW_MS,
  whatsappMessages,
  type ClassifyNumberResponse,
  type PersonalNumbersResponse,
  type WhatsAppInboxResponse,
  type WhatsAppMessage,
  type WhatsAppBotResponse,
  whatsappBotSettingsSchema,
  type WhatsAppThreadResponse,
} from '@leadflow/shared';
import type { z } from 'zod';
import type { AppConfig } from '../../config/env';
import type { StorageProvider } from '../../integrations/storage';
import type { WhatsAppSender } from '../../integrations/whatsapp';
import type { Db } from '../../lib/db';
import { AppError } from '../../lib/errors';
import type { TenantContext } from '../../plugins/tenant';
import { recordAudit } from '../audit/service';
import { ensureStages, LeadService } from '../leads/service';
import { MANAGERS, notifySafe } from '../notifications/service';
import { BookingBot, type BotOutcome } from './bot';

type Status = (typeof WHATSAPP_STATUSES)[number];

/** A customer message from Meta's webhook, already normalised. */
export interface InboundMessage {
  waMessageId: string;
  /** E.164, e.g. +972501234567. */
  from: string;
  /** WhatsApp profile name, if Meta sent one. */
  profileName: string | null;
  body: string;
  /** Id of the tapped button or list row (interactive replies). */
  replyId?: string | null;
  receivedAt: Date;
}

/** What happened to an incoming message. */
export type ReceiveResult =
  | { kind: 'lead'; leadId: string; created: boolean }
  | { kind: 'inbox'; numberId: string; isNew: boolean }
  | { kind: 'ignored' };

interface Log {
  error: (obj: object, msg: string) => void;
}

/** Delivery statuses only move forward ("read" never goes back to "delivered"); "failed" always wins. */
const statusRank: Record<Status, number> = {
  received: 0,
  sent: 1,
  delivered: 2,
  read: 3,
  failed: 4,
};

const sender = { select: { id: true, fullName: true } } as const;
type Row = MessageRow & { sender: { id: string; fullName: string } | null };

function toDto(row: Row): WhatsAppMessage {
  return {
    id: row.id,
    direction: row.direction,
    body: row.body,
    status: (WHATSAPP_STATUSES as readonly string[]).includes(row.status)
      ? (row.status as Status)
      : 'sent',
    sender: row.sender ? { id: row.sender.id, name: row.sender.fullName } : null,
    createdAt: row.createdAt.toISOString(),
  };
}

const INBOX_MESSAGES = 20;

/**
 * F12 POC (D-091, D-092). One WhatsApp number, connected to one business from the environment.
 * Messages from customers become leads; messages from new numbers wait in the inbox until the
 * owner classifies the number; personal numbers are ignored. The team replies from the lead while
 * the 24-hour window is open.
 */
export class WhatsAppService {
  private readonly leads: LeadService;
  private readonly bot: BookingBot;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: AppConfig,
    private readonly sender: WhatsAppSender,
    private readonly log: Log,
    storage: StorageProvider,
  ) {
    this.leads = new LeadService(prisma);
    this.bot = new BookingBot(prisma, sender, log, storage, (tx, businessId, numberId) =>
      this.ensureCustomer(tx, businessId, numberId),
    );
  }

  /** Showcase for booking conversations that stopped in the middle (D-106; background job). */
  nudgeAbandonedBookings(now = new Date()) {
    return this.businessId ? this.bot.nudgeAbandoned(now) : Promise.resolve(0);
  }

  /** The business the number is connected to, or null when WhatsApp is off. */
  get businessId(): string | null {
    return this.config.WHATSAPP_BUSINESS_ID ?? null;
  }

  /**
   * Routes an incoming message by what the business decided about the sender's number:
   * business → the contact's open lead (or a new `whatsapp` lead); personal → dropped, nothing
   * stored; unknown → a known contact makes it business automatically, otherwise it waits in the
   * inbox. Meta retries are ignored by message id.
   */
  async receive(msg: InboundMessage): Promise<ReceiveResult | null> {
    const businessId = this.businessId;
    if (!businessId) return null;
    const seen = await this.prisma.whatsAppMessage.findUnique({
      where: { waMessageId: msg.waMessageId },
      select: { id: true },
    });
    if (seen) return null;

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        let number = await tx.whatsAppNumber.findUnique({
          where: { businessId_phone: { businessId, phone: msg.from } },
        });
        if (number?.status === 'PERSONAL') return { kind: 'ignored' } as const;
        const firstMessage = !number;

        if (!number) {
          const known = await tx.contact.findFirst({
            where: { businessId, phone: msg.from },
            select: { id: true },
          });
          number = await tx.whatsAppNumber.create({
            data: {
              businessId,
              phone: msg.from,
              status: known ? 'BUSINESS' : 'UNCLASSIFIED',
              profileName: known ? null : (msg.profileName?.trim().slice(0, 80) ?? null),
            },
          });
        }

        if (number.status === 'UNCLASSIFIED') {
          if (msg.profileName && msg.profileName !== number.profileName) {
            await tx.whatsAppNumber.update({
              where: { id: number.id },
              data: { profileName: msg.profileName.trim().slice(0, 80) },
            });
          }
          await tx.whatsAppMessage.create({
            data: {
              businessId,
              numberId: number.id,
              direction: 'IN',
              waMessageId: msg.waMessageId,
              body: msg.body.slice(0, 4096),
              status: 'received',
              createdAt: msg.receivedAt,
            },
          });
          return { kind: 'inbox', numberId: number.id, isNew: firstMessage } as const;
        }

        const { contactId, leadId, created } = await this.attachToLead(tx, businessId, {
          phone: msg.from,
          name: msg.profileName,
          firstMessage: msg.body,
        });
        await tx.whatsAppMessage.create({
          data: {
            businessId,
            numberId: number.id,
            contactId,
            leadId,
            direction: 'IN',
            waMessageId: msg.waMessageId,
            body: msg.body.slice(0, 4096),
            status: 'received',
            createdAt: msg.receivedAt,
          },
        });
        return { kind: 'lead', leadId, created } as const;
      });
      const bot = result.kind === 'ignored' ? 'none' : await this.runBot(businessId, msg);
      await this.notifyReceived(businessId, result, msg, bot);
      return result;
    } catch (err) {
      // The same message (or two first messages from a new number) delivered at once: the unique
      // keys stop the second copy.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return null;
      throw err;
    }
  }

  /** The booking bot's turn (D-102); a bot failure never loses the customer's message. */
  private async runBot(businessId: string, msg: InboundMessage): Promise<BotOutcome> {
    try {
      return await this.bot.handle(businessId, {
        from: msg.from,
        body: msg.body,
        replyId: msg.replyId ?? null,
      });
    } catch (err) {
      this.log.error({ errName: (err as Error)?.name }, 'whatsapp bot failed');
      return 'none';
    }
  }

  /**
   * Bell and pop-up for an incoming message (D-097): a new lead or a message on a lead goes to
   * owners/managers and the lead's assignee; a new number in the inbox only on its first message.
   */
  private async notifyReceived(
    businessId: string,
    result: ReceiveResult,
    msg: InboundMessage,
    bot: BotOutcome,
  ) {
    if (result.kind === 'ignored') return;
    // Taps in a bot conversation aren't news; the booking itself notifies.
    if (bot === 'handled' && result.kind === 'lead' && !result.created) return;
    if (result.kind === 'inbox') {
      if (!result.isNew) return;
      return notifySafe(this.prisma, this.log, {
        businessId,
        type: 'whatsapp.new_number',
        data: {
          numberId: result.numberId,
          name: msg.profileName?.trim() || formatIsraeliPhone(msg.from),
        },
        to: { roles: MANAGERS },
      });
    }
    const lead = await this.prisma.lead.findUnique({
      where: { id: result.leadId },
      select: { ownerId: true, contact: { select: { name: true } } },
    });
    if (!lead) return;
    await notifySafe(this.prisma, this.log, {
      businessId,
      ...(result.created
        ? {
            type: 'lead.new' as const,
            data: { leadId: result.leadId, name: lead.contact.name, source: 'whatsapp' },
          }
        : {
            type: 'whatsapp.message' as const,
            data: {
              leadId: result.leadId,
              name: lead.contact.name,
              preview: msg.body.slice(0, 120),
            },
          }),
      to: { roles: MANAGERS, userIds: [lead.ownerId] },
    });
  }

  /**
   * The contact for this phone (reused, or created with the WhatsApp name) and its latest open
   * lead, or a new `whatsapp` lead in the first stage.
   */
  private async attachToLead(
    tx: Db,
    businessId: string,
    input: { phone: string; name: string | null; firstMessage: string; actorId?: string },
  ): Promise<{ contactId: string; leadId: string; created: boolean }> {
    const existing = await tx.contact.findFirst({
      where: { businessId, phone: input.phone },
      orderBy: { createdAt: 'asc' },
    });
    const contact =
      existing ??
      (await tx.contact.create({
        data: {
          businessId,
          name: (input.name?.trim() || formatIsraeliPhone(input.phone)).slice(0, 80),
          phone: input.phone,
        },
      }));
    const open = existing
      ? await tx.lead.findFirst({
          where: { businessId, contactId: contact.id, stage: { kind: 'OPEN' } },
          orderBy: { createdAt: 'desc' },
          select: { id: true },
        })
      : null;
    if (open) return { contactId: contact.id, leadId: open.id, created: false };

    const [first] = await ensureStages(tx, businessId);
    const lead = await tx.lead.create({
      data: {
        businessId,
        contactId: contact.id,
        stageId: first!.id,
        source: 'whatsapp',
        message: input.firstMessage.slice(0, 1000) || null,
      },
    });
    await tx.activity.create({
      data: {
        businessId,
        leadId: lead.id,
        type: 'lead.created',
        actorId: input.actorId ?? null,
        data: { source: 'whatsapp', contactReused: Boolean(existing) },
      },
    });
    await recordAudit(tx, {
      action: 'lead.created',
      businessId,
      actorUserId: input.actorId ?? null,
      entityType: 'lead',
      entityId: lead.id,
      metadata: { source: 'whatsapp' },
    });
    return { contactId: contact.id, leadId: lead.id, created: true };
  }

  /** Delivery receipt for one of our messages. */
  async updateStatus(waMessageId: string, status: Status): Promise<void> {
    const row = await this.prisma.whatsAppMessage.findUnique({ where: { waMessageId } });
    if (!row || row.direction !== 'OUT') return;
    const current = (row.status as Status) in statusRank ? (row.status as Status) : 'sent';
    if (statusRank[status] <= statusRank[current]) return;
    await this.prisma.whatsAppMessage.update({ where: { id: row.id }, data: { status } });
  }

  /** Unclassified numbers with their waiting messages, most recent conversation first. */
  async inbox(ctx: TenantContext): Promise<WhatsAppInboxResponse> {
    const numbers = await this.prisma.whatsAppNumber.findMany({
      where: { businessId: ctx.businessId, status: 'UNCLASSIFIED' },
      include: {
        messages: { include: { sender }, orderBy: { createdAt: 'desc' }, take: INBOX_MESSAGES },
      },
      take: 200,
    });
    return {
      connected: this.businessId === ctx.businessId,
      numbers: numbers
        .filter((n) => n.messages.length > 0)
        .map((n) => ({
          id: n.id,
          phone: n.phone,
          profileName: n.profileName,
          messages: n.messages.map(toDto).reverse(),
          lastMessageAt: n.messages[0]!.createdAt.toISOString(),
        }))
        .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt)),
    };
  }

  async personalNumbers(ctx: TenantContext): Promise<PersonalNumbersResponse> {
    const rows = await this.prisma.whatsAppNumber.findMany({
      where: { businessId: ctx.businessId, status: 'PERSONAL' },
      orderBy: { classifiedAt: 'desc' },
      select: { id: true, phone: true, classifiedAt: true },
      take: 500,
    });
    return {
      numbers: rows.map((r) => ({ ...r, classifiedAt: r.classifiedAt?.toISOString() ?? null })),
    };
  }

  private async requireNumber(db: Db, ctx: TenantContext, numberId: string) {
    const number = /^[0-9a-f-]{36}$/i.test(numberId)
      ? await db.whatsAppNumber.findFirst({ where: { id: numberId, businessId: ctx.businessId } })
      : null;
    if (!number) throw new AppError('NOT_FOUND');
    return number;
  }

  /**
   * Business: the waiting messages move to the contact's lead (created if needed). Personal: the
   * waiting messages are deleted and future ones dropped. Either way the choice is remembered.
   */
  async classify(
    ctx: TenantContext,
    numberId: string,
    as: 'BUSINESS' | 'PERSONAL',
  ): Promise<ClassifyNumberResponse> {
    return this.prisma.$transaction(async (tx) => {
      const number = await this.requireNumber(tx, ctx, numberId);
      if (number.status === 'BUSINESS') {
        if (as === 'PERSONAL') throw new AppError('CONFLICT', whatsappMessages.alreadyCustomer);
        return { status: 'BUSINESS' as const, leadId: null };
      }
      const classified = { classifiedById: ctx.userId, classifiedAt: new Date() };

      if (as === 'PERSONAL') {
        await tx.whatsAppMessage.deleteMany({ where: { numberId: number.id } });
        await tx.whatsAppNumber.update({
          where: { id: number.id },
          data: { status: 'PERSONAL', profileName: null, ...classified },
        });
        await recordAudit(tx, {
          action: 'whatsapp.number_classified',
          businessId: ctx.businessId,
          actorUserId: ctx.userId,
          entityType: 'whatsapp_number',
          entityId: number.id,
          metadata: { as: 'PERSONAL' },
        });
        return { status: 'PERSONAL' as const, leadId: null };
      }

      const { leadId } = await this.promote(tx, ctx.businessId, number, ctx.userId);
      return { status: 'BUSINESS' as const, leadId };
    });
  }

  /**
   * An unclassified number becomes a business number: its waiting messages move to the contact's
   * lead (created if needed). `actorId` null = the booking bot did it.
   */
  private async promote(
    tx: Db,
    businessId: string,
    number: { id: string; phone: string; profileName: string | null },
    actorId: string | null,
  ) {
    const waiting = await tx.whatsAppMessage.findMany({
      where: { numberId: number.id, direction: 'IN' },
      orderBy: { createdAt: 'asc' },
      select: { body: true },
    });
    const { contactId, leadId } = await this.attachToLead(tx, businessId, {
      phone: number.phone,
      name: number.profileName,
      firstMessage: waiting.map((m) => m.body).join('\n'),
      actorId: actorId ?? undefined,
    });
    await tx.whatsAppMessage.updateMany({
      where: { numberId: number.id },
      data: { contactId, leadId },
    });
    await tx.whatsAppNumber.update({
      where: { id: number.id },
      data: {
        status: 'BUSINESS',
        profileName: null,
        classifiedById: actorId,
        classifiedAt: new Date(),
      },
    });
    await recordAudit(tx, {
      action: 'whatsapp.number_classified',
      businessId,
      actorUserId: actorId,
      entityType: 'whatsapp_number',
      entityId: number.id,
      metadata: { as: 'BUSINESS', ...(actorId ? {} : { by: 'booking_bot' }) },
    });
    return { contactId, leadId };
  }

  /** The contact and open lead for a number (used by the booking bot when it books). */
  async ensureCustomer(tx: Db, businessId: string, numberId: string) {
    const number = await tx.whatsAppNumber.findFirst({ where: { id: numberId, businessId } });
    if (!number || number.status === 'PERSONAL') throw new AppError('NOT_FOUND');
    if (number.status === 'UNCLASSIFIED') return this.promote(tx, businessId, number, null);
    const { contactId, leadId } = await this.attachToLead(tx, businessId, {
      phone: number.phone,
      name: null,
      firstMessage: '',
    });
    return { contactId, leadId };
  }

  /** Booking bot settings (D-102). */
  async botSettings(ctx: TenantContext): Promise<WhatsAppBotResponse> {
    const b = await this.prisma.business.findUniqueOrThrow({
      where: { id: ctx.businessId },
      select: {
        industry: true,
        whatsappBotEnabled: true,
        whatsappBotAutoConfirm: true,
        whatsappBotTexts: true,
        whatsappBotShowcase: true,
        whatsappBotFlow: true,
        whatsappBotHoldDate: true,
      },
    });
    const texts = botTextsSchema.safeParse(b.whatsappBotTexts ?? {});
    const chosen = (BOT_FLOWS as readonly string[]).includes(b.whatsappBotFlow ?? '')
      ? (b.whatsappBotFlow as BotFlow)
      : null;
    const sc = botShowcaseSchema.safeParse(b.whatsappBotShowcase ?? { enabled: false });
    const showcase = sc.success ? sc.data : { enabled: false, link: null, assetIds: [] };
    return {
      connected: this.businessId === ctx.businessId,
      settings: {
        enabled: b.whatsappBotEnabled,
        autoConfirm: b.whatsappBotAutoConfirm,
        texts: texts.success ? texts.data : {},
        holdDate: b.whatsappBotHoldDate,
        flow: chosen ?? botFlowFor(b.industry),
        flowIsDefault: chosen === null,
        defaults: botDefaultTextsFor(b.industry),
        showcase: {
          enabled: showcase.enabled,
          ...('text' in showcase && showcase.text ? { text: showcase.text } : {}),
          defaultText: showcaseDefaultText(b.industry),
          link: showcase.link,
          assetIds: showcase.assetIds,
        },
      },
    };
  }

  async updateBotSettings(
    ctx: TenantContext,
    input: z.output<typeof whatsappBotSettingsSchema>,
  ): Promise<WhatsAppBotResponse> {
    await this.prisma.$transaction(async (tx) => {
      await tx.business.update({
        where: { id: ctx.businessId },
        data: {
          whatsappBotEnabled: input.enabled,
          whatsappBotAutoConfirm: input.autoConfirm,
          whatsappBotTexts: input.texts,
          whatsappBotShowcase: input.showcase,
          whatsappBotFlow: input.flow,
          whatsappBotHoldDate: input.holdDate,
        },
      });
      // Switching off ends conversations in progress.
      if (!input.enabled) {
        await tx.whatsAppBotSession.deleteMany({ where: { businessId: ctx.businessId } });
      }
      // Only the business's own photos can go into the showcase.
      if (input.showcase.assetIds.length) {
        const owned = await tx.asset.count({
          where: { id: { in: input.showcase.assetIds }, businessId: ctx.businessId },
        });
        if (owned !== new Set(input.showcase.assetIds).size) {
          throw new AppError('VALIDATION_ERROR', showcaseMessages.imageMissing, {
            'showcase.assetIds': showcaseMessages.imageMissing,
          });
        }
      }
      await recordAudit(tx, {
        action: 'whatsapp.bot_updated',
        businessId: ctx.businessId,
        actorUserId: ctx.userId,
        entityType: 'business',
        entityId: ctx.businessId,
        // Which messages are custom, not their wording.
        metadata: {
          enabled: input.enabled,
          autoConfirm: input.autoConfirm,
          customTexts: Object.keys(input.texts),
          showcase: input.showcase.enabled,
        },
      });
    });
    return this.botSettings(ctx);
  }

  /** Forgets a personal marking; the number's next message lands in the inbox again. */
  async forgetPersonal(ctx: TenantContext, numberId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const number = await this.requireNumber(tx, ctx, numberId);
      if (number.status !== 'PERSONAL') {
        throw new AppError('CONFLICT', whatsappMessages.notPersonal);
      }
      await tx.whatsAppNumber.delete({ where: { id: number.id } });
      await recordAudit(tx, {
        action: 'whatsapp.number_unmarked',
        businessId: ctx.businessId,
        actorUserId: ctx.userId,
        entityType: 'whatsapp_number',
        entityId: number.id,
      });
    });
  }

  /** The conversation with this lead's contact, oldest first. */
  async thread(ctx: TenantContext, leadId: string): Promise<WhatsAppThreadResponse> {
    const lead = await this.leads.findVisible(ctx, leadId);
    const rows = await this.prisma.whatsAppMessage.findMany({
      where: { businessId: ctx.businessId, contactId: lead.contactId },
      include: { sender },
      orderBy: { createdAt: 'asc' },
      take: 500,
    });
    const lastIn = rows.filter((r) => r.direction === 'IN').at(-1);
    const until = lastIn ? lastIn.createdAt.getTime() + WHATSAPP_WINDOW_MS : 0;
    const number = lead.contact.phone
      ? await this.prisma.whatsAppNumber.findUnique({
          where: { businessId_phone: { businessId: ctx.businessId, phone: lead.contact.phone } },
          select: { botPaused: true },
        })
      : null;
    return {
      connected: this.businessId === ctx.businessId,
      messages: rows.map(toDto),
      replyUntil: until > Date.now() ? new Date(until).toISOString() : null,
      botPaused: number?.botPaused ?? false,
    };
  }

  /**
   * Pause or resume the booking bot for this lead's customer (D-108). Pausing also ends a
   * conversation in progress. A customer who hasn't written on WhatsApp yet is remembered too.
   */
  async pauseBot(ctx: TenantContext, leadId: string, paused: boolean): Promise<void> {
    const lead = await this.leads.findVisible(ctx, leadId);
    const phone = lead.contact.phone;
    if (!phone) throw new AppError('CONFLICT', whatsappMessages.noPhone);
    await this.prisma.$transaction(async (tx) => {
      const number = await tx.whatsAppNumber.upsert({
        where: { businessId_phone: { businessId: ctx.businessId, phone } },
        create: { businessId: ctx.businessId, phone, status: 'BUSINESS', botPaused: paused },
        update: { botPaused: paused },
      });
      if (paused) await tx.whatsAppBotSession.deleteMany({ where: { numberId: number.id } });
      await recordAudit(tx, {
        action: paused ? 'whatsapp.bot_paused' : 'whatsapp.bot_resumed',
        businessId: ctx.businessId,
        actorUserId: ctx.userId,
        entityType: 'whatsapp_number',
        entityId: number.id,
      });
    });
  }

  /** Free-form reply; only inside the 24-hour window that the customer's last message opened. */
  async send(ctx: TenantContext, leadId: string, text: string): Promise<WhatsAppMessage> {
    if (this.businessId !== ctx.businessId) {
      throw new AppError('CONFLICT', whatsappMessages.notConnected);
    }
    const lead = await this.leads.findVisible(ctx, leadId);
    const phone = lead.contact.phone;
    if (!phone) throw new AppError('CONFLICT', whatsappMessages.noPhone);
    const lastIn = await this.prisma.whatsAppMessage.findFirst({
      where: { businessId: ctx.businessId, contactId: lead.contactId, direction: 'IN' },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true, numberId: true },
    });
    if (!lastIn || Date.now() - lastIn.createdAt.getTime() > WHATSAPP_WINDOW_MS) {
      throw new AppError('CONFLICT', whatsappMessages.windowClosed);
    }

    let id: string;
    try {
      ({ id } = await this.sender.sendText(phone, text));
    } catch (err) {
      const e = err as { name?: string; status?: number; code?: number | null };
      this.log.error(
        { errName: e?.name, status: e?.status, code: e?.code },
        'whatsapp send failed',
      );
      throw new AppError('INTERNAL_ERROR', whatsappMessages.sendFailed);
    }
    const row = await this.prisma.whatsAppMessage.create({
      data: {
        businessId: ctx.businessId,
        numberId: lastIn.numberId,
        contactId: lead.contactId,
        leadId: lead.id,
        direction: 'OUT',
        waMessageId: id,
        body: text,
        status: 'sent',
        senderId: ctx.userId,
      },
      include: { sender },
    });
    return toDto(row);
  }
}
