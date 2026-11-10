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
  autoReplyDefaultFor,
  setStatusRequestSchema,
  type WhatsAppThreadResponse,
  type Channel,
  attributionSchema,
  type Attribution,
} from '@leadflow/shared';
import type { z } from 'zod';
import type { AppConfig } from '../../config/env';
import type { StorageProvider } from '../../integrations/storage';
import {
  activeOf,
  checkShowcaseVideo,
  showcaseObject,
  showcaseVideoOf,
  mergeStatuses,
  modeOf,
  statusDtos,
  statusesOf,
  languageOf,
} from './auto-reply';
import { MemoryMessengerSender, type MessengerSender } from '../../integrations/messenger';
import { ChannelRegistry } from '../channels/registry';
import type { WhatsAppSender } from '../../integrations/whatsapp';
import type { Db } from '../../lib/db';
import { AppError } from '../../lib/errors';
import type { TenantContext } from '../../plugins/tenant';
import { recordAudit } from '../audit/service';
import { attributionData, ensureStages, LeadService } from '../leads/service';
import { MANAGERS, notifySafe } from '../notifications/service';
import { BookingBot, type BotOutcome } from './bot';

type Status = (typeof WHATSAPP_STATUSES)[number];

/** A customer message from Meta's webhook, already normalised. */
export interface InboundMessage {
  /** Meta's phone number id (WhatsApp) or Page id (Messenger) it was sent to (F25 routing). */
  to?: string;
  waMessageId: string;
  /** WhatsApp: E.164, e.g. +972501234567. Messenger: `fb:` + the sender's PSID (F23). */
  from: string;
  /** Default WhatsApp. */
  channel?: Channel;
  /** WhatsApp profile name, if Meta sent one. */
  profileName: string | null;
  body: string;
  /** Id of the tapped button or list row (interactive replies). */
  replyId?: string | null;
  /** F26: the Meta ad the customer tapped ("Click to WhatsApp" / Messenger ad). */
  attribution?: Attribution | null;
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
/** Messenger senders are stored as `fb:<psid>` (F23). */
const MESSENGER_PREFIX = 'fb:';
const psidOf = (address: string) => address.slice(MESSENGER_PREFIX.length);
/** A Messenger sender without a shared profile name. */
const FACEBOOK_USER = 'משתמש/ת פייסבוק';
type Row = MessageRow & { sender: { id: string; fullName: string } | null };

export function toDto(row: Row, channel?: string): WhatsAppMessage {
  return {
    ...(channel === 'messenger' ? { channel: 'messenger' as const } : {}),
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
    sender: WhatsAppSender,
    private readonly log: Log,
    private readonly storage: StorageProvider,
    messenger: MessengerSender = new MemoryMessengerSender(),
  ) {
    this.leads = new LeadService(prisma);
    // Each business's own channels (F25), with the environment's as the fallback.
    this.channels = new ChannelRegistry(prisma, config, sender, messenger);
    this.bot = new BookingBot(
      prisma,
      (businessId) => this.channels.whatsapp(businessId),
      log,
      storage,
      (tx, businessId, numberId) => this.ensureCustomer(tx, businessId, numberId),
    );
  }

  readonly channels: ChannelRegistry;

  /** Showcase for booking conversations that stopped in the middle (D-106; background job). */
  nudgeAbandonedBookings(now = new Date()) {
    return this.bot.nudgeAbandoned(now);
  }

  /** Any channel connected to this business. */
  connectedTo(businessId: string) {
    return this.channels.isConnected(businessId);
  }

  /**
   * Routes an incoming message by what the business decided about the sender's number:
   * business → the contact's open lead (or a new `whatsapp` lead); personal → dropped, nothing
   * stored; unknown → a known contact makes it business automatically, otherwise it waits in the
   * inbox. Meta retries are ignored by message id.
   */
  async receive(msg: InboundMessage): Promise<ReceiveResult | null> {
    const channel = msg.channel ?? 'whatsapp';
    // The business that connected this number or Page (F25).
    const businessId = await this.channels.businessFor(channel, msg.to);
    if (!businessId) return null;
    const seen = await this.prisma.whatsAppMessage.findUnique({
      where: { waMessageId: msg.waMessageId },
      select: { id: true },
    });
    if (seen) return null;
    // A new Facebook sender: their name comes from their profile (F23).
    if (channel === 'messenger' && !msg.profileName) {
      const known = await this.prisma.whatsAppNumber.findUnique({
        where: { businessId_phone: { businessId, phone: msg.from } },
        select: { id: true },
      });
      const messenger = known ? null : await this.channels.messenger(businessId);
      if (messenger) msg = { ...msg, profileName: await messenger.profileName(psidOf(msg.from)) };
    }

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        let number = await tx.whatsAppNumber.findUnique({
          where: { businessId_phone: { businessId, phone: msg.from } },
        });
        if (number?.status === 'PERSONAL') return { kind: 'ignored' } as const;

        if (!number) {
          // The number is the business's own: every sender is a customer (D-176).
          number = await tx.whatsAppNumber.create({
            data: { businessId, channel, phone: msg.from, status: 'BUSINESS' },
          });
        }
        // A new ad click replaces an earlier one; the lead gets it when it's created (F26).
        if (msg.attribution) {
          number = await tx.whatsAppNumber.update({
            where: { id: number.id },
            data: { attribution: msg.attribution as Prisma.InputJsonObject },
          });
        }
        // A sender who was waiting from before D-176 joins their lead with this message.
        if (number.status === 'UNCLASSIFIED') {
          await this.promote(tx, businessId, number, null);
          number = { ...number, status: 'BUSINESS' };
        }

        const { contactId, leadId, created } = await this.attachToLead(tx, businessId, {
          number,
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
      // Automatic replies and booking are WhatsApp only (F23).
      const bot =
        result.kind === 'ignored' || channel !== 'whatsapp'
          ? 'none'
          : await this.runBot(businessId, msg);
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
          name:
            msg.profileName?.trim() ||
            (msg.channel === 'messenger' ? FACEBOOK_USER : formatIsraeliPhone(msg.from)),
          ...(msg.channel === 'messenger' ? { channel: 'messenger' } : {}),
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
            data: {
              leadId: result.leadId,
              name: lead.contact.name,
              source: msg.channel === 'messenger' ? 'facebook' : 'whatsapp',
            },
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
   * The contact for this sender (reused, or created with their name) and its latest open lead, or
   * a new lead in the first stage. WhatsApp finds the contact by phone (`whatsapp` lead); a
   * Facebook sender is linked to its contact directly (`facebook` lead, no phone; F23).
   */
  private async attachToLead(
    tx: Db,
    businessId: string,
    input: {
      number: {
        id: string;
        phone: string;
        channel: string;
        contactId: string | null;
        attribution?: Prisma.JsonValue;
      };
      name: string | null;
      firstMessage: string;
      actorId?: string;
    },
  ): Promise<{ contactId: string; leadId: string; created: boolean }> {
    const messenger = input.number.channel === 'messenger';
    const source = messenger ? 'facebook' : 'whatsapp';
    const existing = messenger
      ? input.number.contactId
        ? await tx.contact.findFirst({ where: { id: input.number.contactId, businessId } })
        : null
      : await tx.contact.findFirst({
          where: { businessId, phone: input.number.phone },
          orderBy: { createdAt: 'asc' },
        });
    const contact =
      existing ??
      (await tx.contact.create({
        data: {
          businessId,
          name: (
            input.name?.trim() ||
            (messenger ? FACEBOOK_USER : formatIsraeliPhone(input.number.phone))
          ).slice(0, 80),
          phone: messenger ? null : input.number.phone,
        },
      }));
    if (messenger && !existing) {
      await tx.whatsAppNumber.update({
        where: { id: input.number.id },
        data: { contactId: contact.id },
      });
    }
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
        source,
        ...attributionData(
          attributionSchema
            .nullable()
            .catch(null)
            .parse(input.number.attribution ?? null),
        ),
        message: input.firstMessage.slice(0, 1000) || null,
      },
    });
    await tx.activity.create({
      data: {
        businessId,
        leadId: lead.id,
        type: 'lead.created',
        actorId: input.actorId ?? null,
        data: { source, contactReused: Boolean(existing) },
      },
    });
    await recordAudit(tx, {
      action: 'lead.created',
      businessId,
      actorUserId: input.actorId ?? null,
      entityType: 'lead',
      entityId: lead.id,
      metadata: { source },
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
      connected: await this.connectedTo(ctx.businessId),
      numbers: numbers
        .filter((n) => n.messages.length > 0)
        .map((n) => ({
          id: n.id,
          phone: n.phone,
          ...(n.channel === 'messenger' ? { channel: 'messenger' as const } : {}),
          profileName: n.profileName,
          messages: n.messages.map((m) => toDto(m, n.channel)).reverse(),
          lastMessageAt: n.messages[0]!.createdAt.toISOString(),
        }))
        .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt)),
    };
  }

  async personalNumbers(ctx: TenantContext): Promise<PersonalNumbersResponse> {
    const rows = await this.prisma.whatsAppNumber.findMany({
      where: { businessId: ctx.businessId, status: 'PERSONAL' },
      orderBy: { classifiedAt: 'desc' },
      select: { id: true, phone: true, channel: true, classifiedAt: true },
      take: 500,
    });
    return {
      numbers: rows.map((r) => ({
        id: r.id,
        phone: r.phone,
        ...(r.channel === 'messenger'
          ? { channel: 'messenger' as const, name: FACEBOOK_USER }
          : {}),
        classifiedAt: r.classifiedAt?.toISOString() ?? null,
      })),
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
    number: {
      id: string;
      phone: string;
      channel: string;
      contactId: string | null;
      profileName: string | null;
      attribution?: Prisma.JsonValue;
    },
    actorId: string | null,
  ) {
    const waiting = await tx.whatsAppMessage.findMany({
      where: { numberId: number.id, direction: 'IN' },
      orderBy: { createdAt: 'asc' },
      select: { body: true },
    });
    const { contactId, leadId } = await this.attachToLead(tx, businessId, {
      number,
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
      number,
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
        whatsappReplyMode: true,
        whatsappAutoReplyText: true,
        whatsappStatuses: true,
        whatsappActiveStatus: true,
        language: true,
      },
    });
    const lang = languageOf(b.language);
    const statuses = statusesOf(b.whatsappStatuses, lang);
    const active = activeOf(b.whatsappActiveStatus, statuses, new Date());
    const texts = botTextsSchema.safeParse(b.whatsappBotTexts ?? {});
    const chosen = (BOT_FLOWS as readonly string[]).includes(b.whatsappBotFlow ?? '')
      ? (b.whatsappBotFlow as BotFlow)
      : null;
    const sc = botShowcaseSchema.safeParse(b.whatsappBotShowcase ?? { enabled: false });
    const showcase = sc.success ? sc.data : { enabled: false, link: null, assetIds: [] };
    const video = showcaseVideoOf(b.whatsappBotShowcase);
    return {
      connected: await this.channels.isConnected(ctx.businessId, 'whatsapp'),
      settings: {
        mode: modeOf(b.whatsappReplyMode),
        autoReplyText: b.whatsappAutoReplyText,
        autoReplyDefault: autoReplyDefaultFor(lang),
        statuses: statusDtos(statuses),
        activeStatus: active ? { id: active.status.id, until: active.until } : null,
        enabled: b.whatsappBotEnabled,
        autoConfirm: b.whatsappBotAutoConfirm,
        texts: texts.success ? texts.data : {},
        holdDate: b.whatsappBotHoldDate,
        flow: chosen ?? botFlowFor(b.industry),
        flowIsDefault: chosen === null,
        defaults: botDefaultTextsFor(b.industry, lang),
        showcase: {
          enabled: showcase.enabled,
          ...('text' in showcase && showcase.text ? { text: showcase.text } : {}),
          defaultText: showcaseDefaultText(b.industry, lang),
          link: showcase.link,
          assetIds: showcase.assetIds,
          video: video ? { sizeBytes: video.bytes } : null,
        },
      },
    };
  }

  async updateBotSettings(
    ctx: TenantContext,
    input: z.output<typeof whatsappBotSettingsSchema>,
  ): Promise<WhatsAppBotResponse> {
    let dropped: string[] = [];
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.business.findUniqueOrThrow({
        where: { id: ctx.businessId },
        select: {
          whatsappReplyMode: true,
          whatsappStatuses: true,
          whatsappActiveStatus: true,
          whatsappBotShowcase: true,
        },
      });
      // Older clients send only `enabled`: on = booking; off leaves the automatic reply as it was.
      const mode =
        input.mode ??
        (input.enabled
          ? 'booking'
          : modeOf(current.whatsappReplyMode) === 'booking'
            ? 'off'
            : modeOf(current.whatsappReplyMode));
      const enabled = mode === 'booking';
      const video = showcaseVideoOf(current.whatsappBotShowcase);
      let statusData = {};
      if (input.statuses) {
        const result = mergeStatuses(statusesOf(current.whatsappStatuses), input.statuses);
        dropped = result.dropped;
        const active = activeOf(current.whatsappActiveStatus, result.merged, new Date());
        statusData = {
          whatsappStatuses: result.merged,
          // A deleted status can't stay on.
          ...(active ? {} : { whatsappActiveStatus: Prisma.DbNull }),
        };
      }
      await tx.business.update({
        where: { id: ctx.businessId },
        data: {
          whatsappReplyMode: mode,
          whatsappAutoReplyText: input.autoReplyText,
          ...statusData,
          whatsappBotEnabled: enabled,
          whatsappBotAutoConfirm: input.autoConfirm,
          whatsappBotTexts: input.texts,
          // The video is uploaded on its own (D-151); saving the settings keeps it.
          whatsappBotShowcase: {
            ...input.showcase,
            ...(video ? { videoKey: video.key, videoBytes: video.bytes } : {}),
          },
          whatsappBotFlow: input.flow,
          whatsappBotHoldDate: input.holdDate,
        },
      });
      // Leaving the booking bot ends conversations in progress.
      if (!enabled) {
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
          mode,
          customAutoReply: input.autoReplyText !== null,
          statuses: input.statuses?.length,
          enabled,
          autoConfirm: input.autoConfirm,
          customTexts: Object.keys(input.texts),
          showcase: input.showcase.enabled,
        },
      });
    });
    // Videos of deleted statuses (after the change is saved).
    for (const key of dropped) await this.storage.delete(key).catch(() => undefined);
    return this.botSettings(ctx);
  }

  /** Turns a status on (until a time, or until changed) or off (D-123). */
  async setStatus(ctx: TenantContext, input: z.output<typeof setStatusRequestSchema>) {
    const b = await this.prisma.business.findUniqueOrThrow({
      where: { id: ctx.businessId },
      select: { whatsappStatuses: true },
    });
    if (input.id && !statusesOf(b.whatsappStatuses).some((s) => s.id === input.id)) {
      throw new AppError('NOT_FOUND');
    }
    if (input.until && new Date(input.until) <= new Date()) {
      throw new AppError('VALIDATION_ERROR', whatsappMessages.untilPast, {
        until: whatsappMessages.untilPast,
      });
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.business.update({
        where: { id: ctx.businessId },
        data: {
          whatsappActiveStatus: input.id ? { id: input.id, until: input.until } : Prisma.DbNull,
        },
      });
      await recordAudit(tx, {
        action: 'whatsapp.status_set',
        businessId: ctx.businessId,
        actorUserId: ctx.userId,
        entityType: 'business',
        entityId: ctx.businessId,
        metadata: { status: input.id, until: input.until },
      });
    });
    return this.botSettings(ctx);
  }

  /** Stores the "meanwhile" video (D-151), replacing the old one. */
  async setShowcaseVideo(ctx: TenantContext, video: Buffer) {
    const key = checkShowcaseVideo(ctx.businessId, video);
    const b = await this.prisma.business.findUniqueOrThrow({
      where: { id: ctx.businessId },
      select: { whatsappBotShowcase: true },
    });
    await this.storage.put(key, video, 'video/mp4');
    const old = showcaseVideoOf(b.whatsappBotShowcase);
    await this.prisma.business.update({
      where: { id: ctx.businessId },
      data: {
        whatsappBotShowcase: {
          ...showcaseObject(b.whatsappBotShowcase),
          videoKey: key,
          videoBytes: video.length,
        },
      },
    });
    if (old) await this.storage.delete(old.key).catch(() => undefined);
    return this.botSettings(ctx);
  }

  async deleteShowcaseVideo(ctx: TenantContext) {
    const b = await this.prisma.business.findUniqueOrThrow({
      where: { id: ctx.businessId },
      select: { whatsappBotShowcase: true },
    });
    const old = showcaseVideoOf(b.whatsappBotShowcase);
    if (!old) return this.botSettings(ctx);
    const rest = showcaseObject(b.whatsappBotShowcase);
    delete rest.videoKey;
    delete rest.videoBytes;
    await this.prisma.business.update({
      where: { id: ctx.businessId },
      data: { whatsappBotShowcase: rest as Prisma.InputJsonValue },
    });
    await this.storage.delete(old.key).catch(() => undefined);
    return this.botSettings(ctx);
  }

  /** The video's bytes, for the owner's preview (this business's only). */
  async showcaseVideo(ctx: TenantContext): Promise<Buffer> {
    const b = await this.prisma.business.findUniqueOrThrow({
      where: { id: ctx.businessId },
      select: { whatsappBotShowcase: true },
    });
    const v = showcaseVideoOf(b.whatsappBotShowcase);
    const video = v ? await this.storage.get(v.key) : null;
    if (!video) throw new AppError('NOT_FOUND');
    return video;
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
      include: { sender, number: { select: { channel: true } } },
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
      connected: await this.connectedTo(ctx.businessId),
      messages: rows.map((r) => toDto(r, r.number.channel)),
      replyUntil: until > Date.now() ? new Date(until).toISOString() : null,
      botPaused: number?.botPaused ?? false,
      ...(lastIn?.number.channel === 'messenger' ? { channel: 'messenger' as const } : {}),
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
    const lead = await this.leads.findVisible(ctx, leadId);
    const lastIn = await this.prisma.whatsAppMessage.findFirst({
      where: { businessId: ctx.businessId, contactId: lead.contactId, direction: 'IN' },
      orderBy: { createdAt: 'desc' },
      select: {
        createdAt: true,
        numberId: true,
        number: { select: { channel: true, phone: true } },
      },
    });
    // The reply goes where the customer last wrote (F23): WhatsApp or the Facebook Page.
    if (!lastIn) {
      if (!(await this.channels.isConnected(ctx.businessId, 'whatsapp'))) {
        throw new AppError('CONFLICT', whatsappMessages.notConnected);
      }
      throw new AppError(
        'CONFLICT',
        lead.contact.phone ? whatsappMessages.windowClosed : whatsappMessages.noPhone,
      );
    }
    return this.deliver(
      ctx,
      {
        numberId: lastIn.numberId,
        channel: lastIn.number.channel,
        phone: lastIn.number.phone,
        contactId: lead.contactId,
        leadId: lead.id,
      },
      lastIn.createdAt,
      text,
    );
  }

  /**
   * F24 inbox: a reply in one conversation, through its channel. A new sender becomes a customer
   * first (Business: contact and lead), so the reply is never lost.
   */
  async sendOnNumber(
    ctx: TenantContext,
    numberId: string,
    text: string,
  ): Promise<{ message: WhatsAppMessage; leadId: string | null }> {
    let number = await this.requireNumber(this.prisma, ctx, numberId);
    if (number.status === 'PERSONAL') throw new AppError('NOT_FOUND');
    let leadId: string | null = null;
    if (number.status === 'UNCLASSIFIED') {
      leadId = (await this.classify(ctx, numberId, 'BUSINESS')).leadId;
      number = await this.requireNumber(this.prisma, ctx, numberId);
    }
    const contactId =
      number.channel === 'messenger'
        ? number.contactId
        : ((
            await this.prisma.contact.findFirst({
              where: { businessId: ctx.businessId, phone: number.phone },
              orderBy: { createdAt: 'asc' },
              select: { id: true },
            })
          )?.id ?? null);
    if (!leadId && contactId) {
      const lead =
        (await this.prisma.lead.findFirst({
          where: { businessId: ctx.businessId, contactId, stage: { kind: 'OPEN' } },
          orderBy: { createdAt: 'desc' },
          select: { id: true },
        })) ??
        (await this.prisma.lead.findFirst({
          where: { businessId: ctx.businessId, contactId },
          orderBy: { createdAt: 'desc' },
          select: { id: true },
        }));
      leadId = lead?.id ?? null;
    }
    const lastIn = await this.prisma.whatsAppMessage.findFirst({
      where: { numberId: number.id, direction: 'IN' },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    const message = await this.deliver(
      ctx,
      { numberId: number.id, channel: number.channel, phone: number.phone, contactId, leadId },
      lastIn?.createdAt ?? null,
      text,
    );
    return { message, leadId };
  }

  /** Sends through the conversation's channel inside the 24-hour window, and stores the reply. */
  private async deliver(
    ctx: TenantContext,
    to: {
      numberId: string;
      channel: string;
      phone: string;
      contactId: string | null;
      leadId: string | null;
    },
    lastInAt: Date | null,
    text: string,
  ): Promise<WhatsAppMessage> {
    const messenger = to.channel === 'messenger';
    const via = messenger
      ? await this.channels.messenger(ctx.businessId)
      : await this.channels.whatsapp(ctx.businessId);
    if (!via) {
      throw new AppError(
        'CONFLICT',
        messenger ? whatsappMessages.messengerNotConnected : whatsappMessages.notConnected,
      );
    }
    if (!lastInAt || Date.now() - lastInAt.getTime() > WHATSAPP_WINDOW_MS) {
      throw new AppError(
        'CONFLICT',
        messenger ? whatsappMessages.messengerWindowClosed : whatsappMessages.windowClosed,
      );
    }
    let id: string;
    try {
      ({ id } = await via.sendText(messenger ? psidOf(to.phone) : to.phone, text));
    } catch (err) {
      const e = err as { name?: string; status?: number; code?: number | null };
      this.log.error(
        { errName: e?.name, status: e?.status, code: e?.code },
        messenger ? 'messenger send failed' : 'whatsapp send failed',
      );
      throw new AppError('INTERNAL_ERROR', whatsappMessages.sendFailed);
    }
    const row = await this.prisma.whatsAppMessage.create({
      data: {
        businessId: ctx.businessId,
        numberId: to.numberId,
        contactId: to.contactId,
        leadId: to.leadId,
        direction: 'OUT',
        waMessageId: id,
        body: text,
        status: 'sent',
        senderId: ctx.userId,
      },
      include: { sender },
    });
    return toDto(row, to.channel);
  }
}
