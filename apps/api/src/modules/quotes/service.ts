import { Prisma, type PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import {
  can,
  formatAgorot,
  quoteItemSchema,
  quoteMessages,
  quoteTotals,
  QUOTE_TOKEN_PATTERN,
  QUOTE_WEB_PATH,
  type createQuoteRequestSchema,
  type PublicQuote,
  type Quote,
  type QuoteItem,
  type quoteListQuerySchema,
  type upsertQuoteRequestSchema,
} from '@leadflow/shared';
import { z } from 'zod';
import type { AppConfig } from '../../config/env';
import { quoteDecisionTemplate, quoteTemplate, type EmailSender } from '../../integrations/email';
import { generateToken } from '../../lib/crypto';
import type { Db } from '../../lib/db';
import { AppError } from '../../lib/errors';
import type { TenantContext } from '../../plugins/tenant';

const include = {
  lead: { select: { id: true, contact: { select: { name: true, phone: true, email: true } } } },
  business: { select: { name: true, phone: true, address: true, timezone: true } },
} as const;
type Row = Prisma.QuoteGetPayload<{ include: typeof include }>;

type UpsertInput = z.output<typeof upsertQuoteRequestSchema>;
type CreateInput = z.output<typeof createQuoteRequestSchema>;
type ListQuery = z.output<typeof quoteListQuerySchema>;

const FIRST_NUMBER = 1001;
const items = (r: Row): QuoteItem[] => z.array(quoteItemSchema).catch([]).parse(r.items);
const ymd = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
/** Today's date where the business is, as `YYYY-MM-DD`. */
const todayIn = (timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());
const isExpired = (r: Row) =>
  r.status === 'SENT' && r.validUntil !== null && ymd(r.validUntil)! < todayIn(r.business.timezone);

export class QuoteService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: AppConfig,
    private readonly email: EmailSender,
    private readonly log: FastifyBaseLogger,
  ) {}

  private publicUrl(token: string | null) {
    return token ? `${this.config.APP_URL}${QUOTE_WEB_PATH}/${token}` : null;
  }

  private dto(r: Row): Quote {
    const list = items(r);
    const vatRate = Number(r.vatRate);
    return {
      id: r.id,
      number: r.number,
      title: r.title,
      items: list,
      discount: r.discount,
      vatRate,
      notes: r.notes,
      validUntil: ymd(r.validUntil),
      status: r.status,
      expired: isExpired(r),
      totals: quoteTotals(list, r.discount, vatRate),
      lead: { id: r.lead.id },
      customer: r.lead.contact,
      publicUrl: this.publicUrl(r.publicToken),
      sentAt: r.sentAt?.toISOString() ?? null,
      decidedAt: r.decidedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  /** Quotes follow lead visibility: employees only see quotes on leads assigned to them. */
  private visible(ctx: TenantContext): Prisma.QuoteWhereInput {
    return {
      businessId: ctx.businessId,
      ...(can(ctx.role, 'leads.view.all') ? {} : { lead: { ownerId: ctx.userId } }),
    };
  }

  private async findVisible(ctx: TenantContext, id: string, db: Db = this.prisma) {
    const row = /^[0-9a-f-]{36}$/i.test(id)
      ? await db.quote.findFirst({ where: { id, ...this.visible(ctx) }, include })
      : null;
    if (!row) throw new AppError('NOT_FOUND');
    return row;
  }

  private data(input: UpsertInput) {
    return {
      title: input.title,
      items: input.items as unknown as Prisma.InputJsonArray,
      discount: input.discount,
      vatRate: input.vatRate,
      notes: input.notes,
      validUntil: input.validUntil ? new Date(`${input.validUntil}T00:00:00Z`) : null,
    };
  }

  private activity(
    db: Db,
    businessId: string,
    leadId: string,
    actorId: string | null,
    type: 'quote.created' | 'quote.sent' | 'quote.accepted' | 'quote.rejected',
    r: { number: number; total: number },
  ) {
    return db.activity.create({
      data: {
        businessId,
        leadId,
        actorId,
        type,
        data: { number: r.number, total: r.total },
      },
    });
  }

  async list(ctx: TenantContext, q: ListQuery = {}): Promise<Quote[]> {
    const rows = await this.prisma.quote.findMany({
      where: {
        AND: [
          this.visible(ctx),
          ...(q.status ? [{ status: q.status }] : []),
          ...(q.leadId ? [{ leadId: q.leadId }] : []),
        ],
      },
      include,
      orderBy: { number: 'desc' },
      take: 500,
    });
    return rows.map((r) => this.dto(r));
  }

  async get(ctx: TenantContext, id: string): Promise<Quote> {
    return this.dto(await this.findVisible(ctx, id));
  }

  /** Next number per business, under a per-business lock so two quotes never share one. */
  private async nextNumber(tx: Db, businessId: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`quote:${businessId}`}))`;
    const max = await tx.quote.aggregate({ where: { businessId }, _max: { number: true } });
    return Math.max((max._max.number ?? 0) + 1, FIRST_NUMBER);
  }

  async create(ctx: TenantContext, input: CreateInput): Promise<Quote> {
    const row = await this.prisma.$transaction(async (tx) => {
      const lead = await tx.lead.findFirst({
        where: {
          id: input.leadId,
          businessId: ctx.businessId,
          ...(can(ctx.role, 'leads.view.all') ? {} : { ownerId: ctx.userId }),
        },
        select: { id: true },
      });
      if (!lead) {
        throw new AppError('VALIDATION_ERROR', quoteMessages.leadInvalid, {
          leadId: quoteMessages.leadInvalid,
        });
      }
      const created = await tx.quote.create({
        data: {
          businessId: ctx.businessId,
          leadId: lead.id,
          number: await this.nextNumber(tx, ctx.businessId),
          createdById: ctx.userId,
          ...this.data(input),
        },
        include,
      });
      const t = quoteTotals(input.items, input.discount, input.vatRate);
      await this.activity(tx, ctx.businessId, lead.id, ctx.userId, 'quote.created', {
        number: created.number,
        total: t.total,
      });
      return created;
    });
    return this.dto(row);
  }

  async update(ctx: TenantContext, id: string, input: UpsertInput): Promise<Quote> {
    const q = await this.findVisible(ctx, id);
    if (q.status !== 'DRAFT') throw new AppError('CONFLICT', quoteMessages.notDraft);
    const row = await this.prisma.quote.update({
      where: { id: q.id },
      data: this.data(input),
      include,
    });
    return this.dto(row);
  }

  async remove(ctx: TenantContext, id: string): Promise<void> {
    const q = await this.findVisible(ctx, id);
    if (q.status !== 'DRAFT') throw new AppError('CONFLICT', quoteMessages.notDraft);
    await this.prisma.quote.delete({ where: { id: q.id } });
  }

  /** A new draft with the same content (to change a quote that was already sent). */
  async duplicate(ctx: TenantContext, id: string): Promise<Quote> {
    const q = await this.findVisible(ctx, id);
    return this.create(ctx, {
      leadId: q.leadId,
      title: q.title,
      items: items(q),
      discount: q.discount,
      vatRate: Number(q.vatRate),
      notes: q.notes,
      validUntil: ymd(q.validUntil),
    });
  }

  /** Marks the quote sent (creating its link once) and optionally emails the customer. */
  async send(ctx: TenantContext, id: string, opts: { email: boolean }): Promise<Quote> {
    const q = await this.findVisible(ctx, id);
    if (q.status === 'ACCEPTED' || q.status === 'REJECTED') {
      throw new AppError('CONFLICT', quoteMessages.notOpen);
    }
    if (opts.email && !q.lead.contact.email) {
      throw new AppError('VALIDATION_ERROR', quoteMessages.noEmail, {
        email: quoteMessages.noEmail,
      });
    }
    const total = quoteTotals(items(q), q.discount, Number(q.vatRate)).total;
    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.quote.update({
        where: { id: q.id },
        data: {
          status: 'SENT',
          sentAt: new Date(),
          publicToken: q.publicToken ?? generateToken(),
        },
        include,
      });
      await this.activity(tx, ctx.businessId, q.leadId, ctx.userId, 'quote.sent', {
        number: q.number,
        total,
      });
      return updated;
    });
    if (opts.email && q.lead.contact.email) {
      const mail = quoteTemplate({
        businessName: row.business.name,
        customerName: q.lead.contact.name,
        number: q.number,
        total: formatAgorot(total),
        validUntil: row.validUntil ? ymd(row.validUntil)!.split('-').reverse().join('/') : null,
        link: this.publicUrl(row.publicToken)!,
      });
      await this.email.send({ to: q.lead.contact.email, ...mail });
    }
    return this.dto(row);
  }

  /** The business records the customer's answer (e.g. given by phone). */
  async decide(ctx: TenantContext, id: string, status: 'ACCEPTED' | 'REJECTED'): Promise<Quote> {
    const q = await this.findVisible(ctx, id);
    if (q.status === status) return this.dto(q);
    const total = quoteTotals(items(q), q.discount, Number(q.vatRate)).total;
    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.quote.update({
        where: { id: q.id },
        data: { status, decidedAt: new Date() },
        include,
      });
      await this.activity(
        tx,
        ctx.businessId,
        q.leadId,
        ctx.userId,
        status === 'ACCEPTED' ? 'quote.accepted' : 'quote.rejected',
        { number: q.number, total },
      );
      return updated;
    });
    return this.dto(row);
  }

  // ------------------------------------------------------------- customer page

  private async byToken(token: string) {
    const row = QUOTE_TOKEN_PATTERN.test(token)
      ? await this.prisma.quote.findUnique({ where: { publicToken: token }, include })
      : null;
    // Drafts are never public (a duplicated draft has no token anyway).
    if (!row || row.status === 'DRAFT') throw new AppError('NOT_FOUND');
    return row;
  }

  private publicDto(r: Row): PublicQuote {
    const d = this.dto(r);
    return {
      number: d.number,
      title: d.title,
      items: d.items,
      vatRate: d.vatRate,
      notes: d.notes,
      validUntil: d.validUntil,
      status: d.status,
      expired: d.expired,
      totals: d.totals,
      sentAt: d.sentAt,
      customerName: r.lead.contact.name,
      business: { name: r.business.name, phone: r.business.phone, address: r.business.address },
    };
  }

  async publicGet(token: string): Promise<PublicQuote> {
    return this.publicDto(await this.byToken(token));
  }

  /** The customer accepts or rejects a sent, unexpired quote; the team is emailed. */
  async publicDecide(token: string, decision: 'accept' | 'reject'): Promise<PublicQuote> {
    const q = await this.byToken(token);
    if (q.status !== 'SENT') throw new AppError('CONFLICT', quoteMessages.notOpen);
    if (isExpired(q)) throw new AppError('CONFLICT', quoteMessages.expired);
    const status = decision === 'accept' ? 'ACCEPTED' : 'REJECTED';
    const total = quoteTotals(items(q), q.discount, Number(q.vatRate)).total;
    const row = await this.prisma.$transaction(async (tx) => {
      // Only a still-open quote changes (two clicks can't both win).
      const res = await tx.quote.updateMany({
        where: { id: q.id, status: 'SENT' },
        data: { status, decidedAt: new Date() },
      });
      if (res.count === 0) throw new AppError('CONFLICT', quoteMessages.notOpen);
      await this.activity(
        tx,
        q.businessId,
        q.leadId,
        null,
        status === 'ACCEPTED' ? 'quote.accepted' : 'quote.rejected',
        { number: q.number, total },
      );
      return tx.quote.findUniqueOrThrow({ where: { id: q.id }, include });
    });
    void this.notifyTeam(row, status === 'ACCEPTED', total);
    return this.publicDto(row);
  }

  private async notifyTeam(q: Row, accepted: boolean, total: number) {
    const team = await this.prisma.membership.findMany({
      where: { businessId: q.businessId, status: 'ACTIVE', role: { in: ['OWNER', 'MANAGER'] } },
      select: { user: { select: { email: true, status: true } } },
    });
    const mail = quoteDecisionTemplate({
      businessName: q.business.name,
      customerName: q.lead.contact.name,
      number: q.number,
      accepted,
      total: formatAgorot(total),
      link: `${this.config.APP_URL}/b/${q.businessId}/quotes/${q.id}`,
    });
    for (const { user } of team) {
      if (user.status !== 'ACTIVE') continue;
      try {
        await this.email.send({ to: user.email, ...mail });
      } catch (err) {
        this.log.error(
          { errName: (err as Error)?.name, template: 'quoteDecision' },
          'email failed',
        );
      }
    }
  }
}
