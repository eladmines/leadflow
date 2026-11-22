import { createHash, randomUUID } from 'node:crypto';
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
  type EmailInbound,
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
} from '@simplecatch/shared';
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
  questionsOf,
  statusesOf,
  languageOf,
} from './auto-reply';
import { createGmailApi, type GmailApi, type GmailMessage } from '../../integrations/gmail';
import { MemoryMessengerSender, type MessengerSender } from '../../integrations/messenger';
import { ChannelRegistry } from '../channels/registry';
import { MemoryEmailSender, type EmailSender } from '../../integrations/email';
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
  /** Email only: the subject line (F27). */
  subject?: string;
  /**
   * A new sender waits in the inbox to be marked business or personal (Gmail, F29: a personal
   * inbox holds private mail too) instead of becoming a customer at once (D-176).
   */
  holdUntilApproved?: boolean;
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
/** Messenger senders are stored as `fb:<psid>` (F23), Instagram ones as `ig:<id>` (F28). */
const psidOf = (address: string) => address.slice(address.indexOf(':') + 1);
/** Facebook and Instagram conversations: contacts without a phone, replies within 24 hours. */
const isSocial = (channel: string | undefined): channel is 'messenger' | 'instagram' =>
  channel === 'messenger' || channel === 'instagram';
/** Email senders are stored as `mail:<address>` (F27). */
const EMAIL_PREFIX = 'mail:';
const addressOf = (address: string) => address.slice(EMAIL_PREFIX.length);
/** A message id that fits the column: kept as is when short, else hashed (then it can't be quoted back). */
const storedMailId = (messageId: string) =>
  messageId.length <= 120
    ? `m:${messageId}`
    : `h:${createHash('sha1').update(messageId).digest('hex')}`;
const quotedMailId = (stored: string) =>
  stored.startsWith('m:') || stored.startsWith('g:') ? stored.slice(2) : undefined;
/** A Gmail message's stored id: `g:<Message-ID>` (quotable), hashed when too long, else Gmail's own id. */
function storedGmailId(mail: { id: string; messageId: string }): string {
  if (!mail.messageId) return `gi:${mail.id}`;
  return mail.messageId.length <= 120
    ? `g:${mail.messageId}`
    : `gh:${createHash('sha1').update(mail.messageId).digest('hex')}`;
}
const isGmailId = (stored: string) => /^(g|gh|gi):/.test(stored);
/** Quoted earlier messages (`>` lines and "On … wrote:") are cut; what is new stays. */
function cleanEmailText(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  for (const line of lines) {
    if (/^\s*>/.test(line)) continue;
    if (/^(on .+ wrote:|ב-.+(כתב|כתבה)[^:]*:)\s*$/i.test(line.trim())) break;
    out.push(line);
  }
  return out.join('\n').trim();
}
const mailName = (address: string) => address.split('@')[0]!.slice(0, 80);
/** A Messenger / Instagram sender without a shared profile name. */
const FACEBOOK_USER = 'משתמש/ת פייסבוק';
const INSTAGRAM_USER = 'משתמש/ת אינסטגרם';
const socialUser = (channel: string | undefined) =>
  channel === 'instagram' ? INSTAGRAM_USER : FACEBOOK_USER;
type Row = MessageRow & { sender: { id: string; fullName: string } | null };

export function toDto(row: Row, channel?: string): WhatsAppMessage {
  return {
    ...(isSocial(channel) || channel === 'email' ? { channel } : {}),
    ...(row.subject ? { subject: row.subject } : {}),
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
    private readonly email: EmailSender = new MemoryEmailSender(),
    private readonly gmail: GmailApi = createGmailApi(config),
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
   * A message the business sent from its Facebook Page itself (Meta's "echo"), so the conversation
   * shows both sides. Only into a conversation that already exists; one sent from this app is
   * already stored under the same message id.
   */
  async receiveEcho(msg: {
    channel?: 'messenger' | 'instagram';
    /** The Page id (Messenger) or Instagram account id (Instagram) that sent it. */
    pageId: string;
    customer: string;
    waMessageId: string;
    body: string;
    sentAt: Date;
  }): Promise<void> {
    const businessId = await this.channels.businessFor(msg.channel ?? 'messenger', msg.pageId);
    if (!businessId) return;
    const seen = await this.prisma.whatsAppMessage.findUnique({
      where: { waMessageId: msg.waMessageId },
      select: { id: true },
    });
    if (seen) return;
    const number = await this.prisma.whatsAppNumber.findUnique({
      where: { businessId_phone: { businessId, phone: msg.customer } },
    });
    if (!number || number.status !== 'BUSINESS') return;
    try {
      await this.prisma.whatsAppMessage.create({
        data: {
          businessId,
          numberId: number.id,
          contactId: number.contactId,
          leadId: await this.openLeadOf(businessId, number.contactId),
          direction: 'OUT',
          waMessageId: msg.waMessageId,
          body: msg.body.slice(0, 4096),
          status: 'sent',
          createdAt: msg.sentAt,
        },
      });
    } catch (err) {
      // Meta delivered it twice at once: the first one is stored.
      if ((err as { code?: string })?.code !== 'P2002') throw err;
    }
  }

  /** The contact's newest lead (the conversation's), if any. */
  private async openLeadOf(businessId: string, contactId: string | null) {
    if (!contactId) return null;
    const lead = await this.prisma.lead.findFirst({
      where: { businessId, contactId },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    return lead?.id ?? null;
  }

  /**
   * Routes an incoming message by what the business decided about the sender's number:
   * business → the contact's open lead (or a new `whatsapp` lead); personal → dropped, nothing
   * stored; unknown → a known contact makes it business automatically, otherwise it waits in the
   * inbox. Meta retries are ignored by message id.
   */
  async receive(
    msg: InboundMessage,
    /** Already known (Gmail sync): skips the routing by number or Page. */
    knownBusinessId?: string,
  ): Promise<ReceiveResult | null> {
    const channel = msg.channel ?? 'whatsapp';
    // The business that connected this number or Page (F25).
    const businessId = knownBusinessId ?? (await this.channels.businessFor(channel, msg.to));
    if (!businessId) return null;
    const seen = await this.prisma.whatsAppMessage.findUnique({
      where: { waMessageId: msg.waMessageId },
      select: { id: true },
    });
    if (seen) return null;
    // A new Facebook / Instagram sender: their name comes from their profile (F23, F28).
    if (isSocial(channel) && !msg.profileName) {
      const known = await this.prisma.whatsAppNumber.findUnique({
        where: { businessId_phone: { businessId, phone: msg.from } },
        select: { id: true },
      });
      const social = known
        ? null
        : channel === 'instagram'
          ? await this.channels.instagram(businessId)
          : await this.channels.messenger(businessId);
      if (social) msg = { ...msg, profileName: await social.profileName(psidOf(msg.from)) };
    }

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        let number = await tx.whatsAppNumber.findUnique({
          where: { businessId_phone: { businessId, phone: msg.from } },
        });
        if (number?.status === 'PERSONAL') return { kind: 'ignored' } as const;

        let isNew = false;
        if (!number) {
          // The number is the business's own: every sender is a customer (D-176), except where the
          // inbox is shared with private mail (Gmail): then the owner decides first.
          number = await tx.whatsAppNumber.create({
            data: {
              businessId,
              channel,
              phone: msg.from,
              status: msg.holdUntilApproved ? 'UNCLASSIFIED' : 'BUSINESS',
              ...(msg.holdUntilApproved
                ? { profileName: msg.profileName?.slice(0, 80) ?? null }
                : {}),
            },
          });
          isNew = true;
        }
        // A new ad click replaces an earlier one; the lead gets it when it's created (F26).
        if (msg.attribution) {
          number = await tx.whatsAppNumber.update({
            where: { id: number.id },
            data: { attribution: msg.attribution as Prisma.InputJsonObject },
          });
        }
        // Waiting for the owner's decision: the message is kept, nothing else is created yet.
        if (number.status === 'UNCLASSIFIED' && msg.holdUntilApproved) {
          await tx.whatsAppMessage.create({
            data: {
              businessId,
              numberId: number.id,
              direction: 'IN',
              waMessageId: msg.waMessageId,
              body: msg.body.slice(0, 4096),
              ...(msg.subject ? { subject: msg.subject.slice(0, 300) } : {}),
              status: 'received',
              createdAt: msg.receivedAt,
            },
          });
          return { kind: 'inbox', numberId: number.id, isNew } as const;
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
            ...(msg.subject ? { subject: msg.subject.slice(0, 300) } : {}),
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

  /**
   * F27: an email to a business's forwarding address (already verified and parsed by the webhook).
   * Auto-generated mail, loops (our own address or domain) and unknown recipients are dropped;
   * the rest goes the same way as any other channel: contact, lead, conversation.
   */
  async receiveEmail(mail: EmailInbound): Promise<ReceiveResult | null> {
    const domain = this.config.EMAIL_INBOUND_DOMAIN;
    if (mail.autoSubmitted || mail.from === mail.to) return null;
    if (domain && mail.from.endsWith(`@${domain}`)) return null;
    const subject = mail.subject.replace(/[\r\n]+/g, ' ').trim();
    const text = cleanEmailText(mail.text);
    return this.receive({
      channel: 'email',
      to: mail.to,
      waMessageId: storedMailId(mail.messageId),
      from: `${EMAIL_PREFIX}${mail.from}`,
      profileName: mail.fromName?.trim().slice(0, 80) || null,
      body: text || subject || '[מייל ללא טקסט]',
      subject,
      receivedAt: mail.receivedAt ? new Date(mail.receivedAt) : new Date(),
    });
  }

  /**
   * F29: one message from a business's connected Gmail inbox. The sender waits to be marked
   * business or personal; the message id keeps imports idempotent and lets a reply quote it.
   */
  async receiveGmail(businessId: string, mail: GmailMessage): Promise<ReceiveResult | null> {
    const text = cleanEmailText(mail.text);
    const subject = mail.subject.replace(/[\r\n]+/g, ' ').trim();
    return this.receive(
      {
        channel: 'email',
        waMessageId: storedGmailId(mail),
        from: `${EMAIL_PREFIX}${mail.from}`,
        profileName: mail.fromName?.trim().slice(0, 80) || null,
        body: text || subject || '[מייל ללא טקסט]',
        subject,
        holdUntilApproved: true,
        receivedAt: new Date(mail.receivedAt),
      },
      businessId,
    );
  }

  /**
   * F29, every couple of minutes: the new inbox mail of every connected Gmail. A revoked or expired
   * grant is logged and skipped (the owner reconnects); one business never blocks another.
   */
  async syncGmail(now = new Date()): Promise<number> {
    const rows = await this.prisma.channelConnection.findMany({
      where: { channel: 'gmail' },
      select: { businessId: true },
    });
    let imported = 0;
    for (const { businessId } of rows) {
      const conn = await this.channels.gmail(businessId);
      if (!conn) continue;
      try {
        const cursor = conn.syncCursor ?? now.getTime();
        const accessToken = await this.gmail.accessToken(conn.refreshToken);
        const mails = await this.gmail.listInbox(accessToken, cursor);
        let newest = cursor;
        for (const mail of mails) {
          newest = Math.max(newest, mail.receivedAt);
          if (mail.receivedAt <= cursor || mail.skip || mail.from === conn.email) continue;
          if (await this.receiveGmail(businessId, mail)) imported += 1;
        }
        if (newest !== cursor || conn.syncCursor === null) {
          await this.prisma.channelConnection.update({
            where: { id: conn.id },
            data: { syncCursor: BigInt(newest) },
          });
        }
      } catch (err) {
        this.log.error({ errName: (err as Error)?.name }, 'gmail sync failed');
      }
    }
    return imported;
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
            (isSocial(msg.channel) ? socialUser(msg.channel) : formatIsraeliPhone(msg.from)),
          ...(isSocial(msg.channel) || msg.channel === 'email' ? { channel: msg.channel } : {}),
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
              source:
                msg.channel === 'messenger'
                  ? 'facebook'
                  : msg.channel === 'instagram'
                    ? 'instagram'
                    : msg.channel === 'email'
                      ? 'email'
                      : 'whatsapp',
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
    const channel = input.number.channel;
    const messenger = isSocial(channel);
    const email = channel === 'email';
    const address = email ? addressOf(input.number.phone) : null;
    const source =
      channel === 'instagram' ? 'instagram' : messenger ? 'facebook' : email ? 'email' : 'whatsapp';
    // Messenger and email senders are linked to their contact directly; WhatsApp ones are matched
    // by phone.
    const existing = messenger
      ? input.number.contactId
        ? await tx.contact.findFirst({ where: { id: input.number.contactId, businessId } })
        : null
      : email
        ? input.number.contactId
          ? await tx.contact.findFirst({ where: { id: input.number.contactId, businessId } })
          : await tx.contact.findFirst({
              where: { businessId, email: { equals: address!, mode: 'insensitive' } },
              orderBy: { createdAt: 'asc' },
            })
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
            (messenger
              ? socialUser(channel)
              : email
                ? mailName(address!)
                : formatIsraeliPhone(input.number.phone))
          ).slice(0, 80),
          phone: messenger || email ? null : input.number.phone,
          ...(email ? { email: address! } : {}),
        },
      }));
    if ((messenger || email) && input.number.contactId !== contact.id) {
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
          ...(isSocial(n.channel)
            ? { channel: n.channel }
            : n.channel === 'email'
              ? { channel: 'email' as const }
              : {}),
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
        ...(isSocial(r.channel) ? { channel: r.channel, name: socialUser(r.channel) } : {}),
        ...(r.channel === 'email' ? { channel: 'email' as const, name: addressOf(r.phone) } : {}),
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
        whatsappQuestions: true,
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
        questions: questionsOf(b.whatsappQuestions),
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
          ...(input.questions ? { whatsappQuestions: input.questions } : {}),
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
          questions: input.questions?.length,
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
      ...(isSocial(lastIn?.number.channel) || lastIn?.number.channel === 'email'
        ? { channel: lastIn.number.channel }
        : {}),
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
      number.channel !== 'whatsapp'
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
    if (to.channel === 'email') return this.deliverEmail(ctx, to, text);
    const social = isSocial(to.channel);
    const instagram = to.channel === 'instagram';
    const via = instagram
      ? await this.channels.instagram(ctx.businessId)
      : social
        ? await this.channels.messenger(ctx.businessId)
        : await this.channels.whatsapp(ctx.businessId);
    if (!via) {
      throw new AppError(
        'CONFLICT',
        instagram
          ? whatsappMessages.instagramNotConnected
          : social
            ? whatsappMessages.messengerNotConnected
            : whatsappMessages.notConnected,
      );
    }
    if (!lastInAt || Date.now() - lastInAt.getTime() > WHATSAPP_WINDOW_MS) {
      throw new AppError(
        'CONFLICT',
        instagram
          ? whatsappMessages.instagramWindowClosed
          : social
            ? whatsappMessages.messengerWindowClosed
            : whatsappMessages.windowClosed,
      );
    }
    let id: string;
    try {
      ({ id } = await via.sendText(social ? psidOf(to.phone) : to.phone, text));
    } catch (err) {
      const e = err as { name?: string; status?: number; code?: number | null };
      this.log.error(
        { errName: e?.name, status: e?.status, code: e?.code },
        instagram
          ? 'instagram send failed'
          : social
            ? 'messenger send failed'
            : 'whatsapp send failed',
      );
      throw new AppError('INTERNAL_ERROR', whatsappMessages.sendFailed);
    }
    const data = {
      businessId: ctx.businessId,
      numberId: to.numberId,
      contactId: to.contactId,
      leadId: to.leadId,
      direction: 'OUT' as const,
      waMessageId: id,
      body: text,
      status: 'sent',
      senderId: ctx.userId,
    };
    // Messenger's echo of this very reply can land first; it then gets this sender.
    const row = await this.prisma.whatsAppMessage.upsert({
      where: { waMessageId: id },
      create: data,
      update: { senderId: ctx.userId },
      include: { sender },
    });
    return toDto(row, to.channel);
  }

  /**
   * F27: a reply by email, from the business's forwarding address (so the customer's answer comes
   * back to the same conversation). No 24-hour window. Sent as plain text, quoting nothing.
   */
  /** F29: a reply from the connected Gmail, threaded under the mail it answers. */
  private async deliverGmail(
    ctx: TenantContext,
    to: { numberId: string; phone: string; contactId: string | null; leadId: string | null },
    text: string,
    gm: { email: string; refreshToken: string },
    last: { subject: string | null; waMessageId: string },
  ): Promise<WhatsAppMessage> {
    const base = (last.subject ?? '').replace(/^(\s*re:\s*)+/i, '').trim() || '-';
    const subject = `Re: ${base}`.slice(0, 300);
    const quoted = quotedMailId(last.waMessageId);
    let id: string;
    try {
      const accessToken = await this.gmail.accessToken(gm.refreshToken);
      ({ id } = await this.gmail.send(accessToken, {
        from: gm.email,
        to: addressOf(to.phone),
        subject,
        text,
        ...(quoted ? { inReplyTo: quoted } : {}),
      }));
    } catch (err) {
      this.log.error({ errName: (err as Error)?.name }, 'gmail send failed');
      throw new AppError('INTERNAL_ERROR', whatsappMessages.sendFailed);
    }
    const row = await this.prisma.whatsAppMessage.create({
      data: {
        businessId: ctx.businessId,
        numberId: to.numberId,
        contactId: to.contactId,
        leadId: to.leadId,
        direction: 'OUT',
        waMessageId: `go:${id}`,
        body: text.slice(0, 4096),
        subject,
        status: 'sent',
        senderId: ctx.userId,
      },
      include: { sender },
    });
    return toDto(row, 'email');
  }

  private async deliverEmail(
    ctx: TenantContext,
    to: { numberId: string; phone: string; contactId: string | null; leadId: string | null },
    text: string,
  ): Promise<WhatsAppMessage> {
    // A conversation that came from the owner's Gmail is answered from that Gmail (F29).
    const last = await this.prisma.whatsAppMessage.findFirst({
      where: { numberId: to.numberId, direction: 'IN' },
      orderBy: { createdAt: 'desc' },
      select: { subject: true, waMessageId: true },
    });
    if (last && isGmailId(last.waMessageId)) {
      const gm = await this.channels.gmail(ctx.businessId);
      if (gm) return this.deliverGmail(ctx, to, text, gm, last);
    }
    const from = await this.channels.emailAddress(ctx.businessId);
    if (!from) throw new AppError('CONFLICT', whatsappMessages.emailNotConnected);
    if (this.config.EMAIL_TRANSPORT === 'disabled') {
      throw new AppError('CONFLICT', whatsappMessages.emailNotConfigured);
    }
    const [business, lastIn] = await Promise.all([
      this.prisma.business.findUnique({ where: { id: ctx.businessId }, select: { name: true } }),
      this.prisma.whatsAppMessage.findFirst({
        where: { numberId: to.numberId, direction: 'IN' },
        orderBy: { createdAt: 'desc' },
        select: { subject: true, waMessageId: true },
      }),
    ]);
    const name = (business?.name ?? '').replace(/["<>,\r\n]/g, ' ').trim();
    const base = (lastIn?.subject ?? '').replace(/^(\s*re:\s*)+/i, '').trim() || name || '-';
    const subject = `Re: ${base}`.slice(0, 300);
    const escaped = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');
    try {
      await this.email.send({
        to: addressOf(to.phone),
        from: name ? `${name} <${from}>` : from,
        replyTo: from,
        ...(lastIn && quotedMailId(lastIn.waMessageId)
          ? { inReplyTo: `<${quotedMailId(lastIn.waMessageId)!.replace(/^<|>$/g, '')}>` }
          : {}),
        subject,
        text,
        html: `<div dir="auto">${escaped}</div>`,
      });
    } catch (err) {
      this.log.error({ errName: (err as Error)?.name }, 'email send failed');
      throw new AppError('INTERNAL_ERROR', whatsappMessages.sendFailed);
    }
    const row = await this.prisma.whatsAppMessage.create({
      data: {
        businessId: ctx.businessId,
        numberId: to.numberId,
        contactId: to.contactId,
        leadId: to.leadId,
        direction: 'OUT',
        waMessageId: `o:${randomUUID()}`,
        body: text.slice(0, 4096),
        subject,
        status: 'sent',
        senderId: ctx.userId,
      },
      include: { sender },
    });
    return toDto(row, 'email');
  }
}
