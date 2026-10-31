import { Prisma, type PrismaClient, type WhatsAppMessage as MessageRow } from '@prisma/client';
import {
  formatIsraeliPhone,
  WHATSAPP_STATUSES,
  WHATSAPP_WINDOW_MS,
  whatsappMessages,
  type WhatsAppMessage,
  type WhatsAppThreadResponse,
} from '@leadflow/shared';
import type { AppConfig } from '../../config/env';
import type { WhatsAppSender } from '../../integrations/whatsapp';
import { AppError } from '../../lib/errors';
import type { TenantContext } from '../../plugins/tenant';
import { recordAudit } from '../audit/service';
import { ensureStages, LeadService } from '../leads/service';

type Status = (typeof WHATSAPP_STATUSES)[number];

/** A customer message from Meta's webhook, already normalised. */
export interface InboundMessage {
  waMessageId: string;
  /** E.164, e.g. +972501234567. */
  from: string;
  /** WhatsApp profile name, if Meta sent one. */
  profileName: string | null;
  body: string;
  receivedAt: Date;
}

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

/**
 * F12 POC (D-091). One WhatsApp number, connected to one business from the environment.
 * Incoming messages become leads; the team replies from the lead while the 24-hour window is open.
 */
export class WhatsAppService {
  private readonly leads: LeadService;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: AppConfig,
    private readonly sender: WhatsAppSender,
    private readonly log: Log,
  ) {
    this.leads = new LeadService(prisma);
  }

  /** The business the number is connected to, or null when WhatsApp is off. */
  get businessId(): string | null {
    return this.config.WHATSAPP_BUSINESS_ID ?? null;
  }

  /**
   * Stores an incoming message. A contact with an open lead keeps talking on that lead; otherwise
   * a new lead (source `whatsapp`) is created in the first stage. Meta retries are ignored by id.
   */
  async receive(msg: InboundMessage): Promise<{ leadId: string; created: boolean } | null> {
    const businessId = this.businessId;
    if (!businessId) return null;
    const seen = await this.prisma.whatsAppMessage.findUnique({
      where: { waMessageId: msg.waMessageId },
      select: { id: true },
    });
    if (seen) return null;

    try {
      return await this.prisma.$transaction(async (tx) => {
        const existing = await tx.contact.findFirst({
          where: { businessId, phone: msg.from },
          orderBy: { createdAt: 'asc' },
        });
        const contact =
          existing ??
          (await tx.contact.create({
            data: {
              businessId,
              name: (msg.profileName?.trim() || formatIsraeliPhone(msg.from)).slice(0, 80),
              phone: msg.from,
            },
          }));
        const open = existing
          ? await tx.lead.findFirst({
              where: { businessId, contactId: contact.id, stage: { kind: 'OPEN' } },
              orderBy: { createdAt: 'desc' },
              select: { id: true },
            })
          : null;

        let leadId = open?.id;
        if (!leadId) {
          const [first] = await ensureStages(tx, businessId);
          const lead = await tx.lead.create({
            data: {
              businessId,
              contactId: contact.id,
              stageId: first!.id,
              source: 'whatsapp',
              message: msg.body.slice(0, 1000),
            },
          });
          leadId = lead.id;
          await tx.activity.create({
            data: {
              businessId,
              leadId,
              type: 'lead.created',
              data: { source: 'whatsapp', contactReused: Boolean(existing) },
            },
          });
          await recordAudit(tx, {
            action: 'lead.created',
            businessId,
            entityType: 'lead',
            entityId: leadId,
            metadata: { source: 'whatsapp' },
          });
        }

        await tx.whatsAppMessage.create({
          data: {
            businessId,
            contactId: contact.id,
            leadId,
            direction: 'IN',
            waMessageId: msg.waMessageId,
            body: msg.body.slice(0, 4096),
            status: 'received',
            createdAt: msg.receivedAt,
          },
        });
        return { leadId, created: !open };
      });
    } catch (err) {
      // The same message delivered twice at once: the unique id stops the second copy.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return null;
      throw err;
    }
  }

  /** Delivery receipt for one of our messages. */
  async updateStatus(waMessageId: string, status: Status): Promise<void> {
    const row = await this.prisma.whatsAppMessage.findUnique({ where: { waMessageId } });
    if (!row || row.direction !== 'OUT') return;
    const current = (row.status as Status) in statusRank ? (row.status as Status) : 'sent';
    if (statusRank[status] <= statusRank[current]) return;
    await this.prisma.whatsAppMessage.update({ where: { id: row.id }, data: { status } });
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
    return {
      connected: this.businessId === ctx.businessId,
      messages: rows.map(toDto),
      replyUntil: until > Date.now() ? new Date(until).toISOString() : null,
    };
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
      select: { createdAt: true },
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
