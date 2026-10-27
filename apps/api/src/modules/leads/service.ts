import { Prisma, type PrismaClient } from '@prisma/client';
import {
  ACTIVITY_TYPES,
  can,
  crmMessages,
  DEFAULT_PIPELINE_STAGES,
  normalizeIsraeliPhone,
  type Activity,
  type createLeadRequestSchema,
  type DuplicateContact,
  type Lead,
  type leadListQuerySchema,
  type LeadSubmission,
  type PipelineStage,
  type updateLeadRequestSchema,
} from '@leadflow/shared';
import type { z } from 'zod';
import type { Db } from '../../lib/db';
import { AppError } from '../../lib/errors';
import type { TenantContext } from '../../plugins/tenant';
import { recordAudit } from '../audit/service';

const leadInclude = {
  contact: { select: { id: true, name: true, phone: true, email: true } },
  stage: { select: { id: true, name: true, kind: true } },
  owner: { select: { id: true, fullName: true } },
} as const;
type LeadRow = Prisma.LeadGetPayload<{ include: typeof leadInclude }>;

export function toLeadDto(row: LeadRow): Lead {
  return {
    id: row.id,
    contact: row.contact,
    stage: row.stage,
    source: row.source,
    sourceUrl: row.sourceUrl,
    message: row.message,
    owner: row.owner ? { id: row.owner.id, name: row.owner.fullName } : null,
    expectedValue: row.expectedValue,
    nextActionAt: row.nextActionAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

type ListQuery = z.output<typeof leadListQuerySchema>;
type CreateInput = z.output<typeof createLeadRequestSchema>;
type UpdateInput = z.output<typeof updateLeadRequestSchema>;

/** The business's pipeline stages, creating the PRD defaults the first time. */
export async function ensureStages(db: Db, businessId: string) {
  const existing = await db.pipelineStage.findMany({
    where: { businessId },
    orderBy: { position: 'asc' },
  });
  if (existing.length > 0) return existing;
  await db.pipelineStage.createMany({
    data: DEFAULT_PIPELINE_STAGES.map((s, i) => ({
      businessId,
      name: s.name,
      kind: s.kind,
      position: i,
    })),
    skipDuplicates: true,
  });
  return db.pipelineStage.findMany({ where: { businessId }, orderBy: { position: 'asc' } });
}

export interface WebsiteSubmission {
  businessId: string;
  siteId: string;
  idempotencyKey: string;
  ipHash: string;
  sourceUrl: string;
  data: LeadSubmission;
}

export class LeadService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Creates a lead from a website form: reuses the contact with the same phone (no lost source:
   * every submission is its own lead), first pipeline stage, activity + audit — one transaction.
   * The same idempotency key twice returns the existing lead with `created: false`.
   */
  async createFromWebsite(input: WebsiteSubmission): Promise<{ lead: Lead; created: boolean }> {
    const dup = await this.findByIdempotencyKey(input.siteId, input.idempotencyKey);
    if (dup) return { lead: dup, created: false };

    try {
      const lead = await this.prisma.$transaction(async (tx) => {
        const [first] = await ensureStages(tx, input.businessId);
        const { name, phone, email, message } = input.data;
        const existing = await tx.contact.findFirst({
          where: { businessId: input.businessId, phone },
          orderBy: { createdAt: 'asc' },
        });
        const contact = existing
          ? await tx.contact.update({
              where: { id: existing.id },
              // Keep the stored name; fill in an email we didn't have.
              data: email && !existing.email ? { email } : {},
            })
          : await tx.contact.create({ data: { businessId: input.businessId, name, phone, email } });

        const created = await tx.lead.create({
          data: {
            businessId: input.businessId,
            contactId: contact.id,
            stageId: first!.id,
            source: 'website_form',
            sourceUrl: input.sourceUrl,
            message,
          },
          include: leadInclude,
        });
        await tx.formSubmission.create({
          data: {
            businessId: input.businessId,
            siteId: input.siteId,
            idempotencyKey: input.idempotencyKey,
            payload: { name, phone, email, message },
            consentAt: new Date(),
            ipHash: input.ipHash,
            leadId: created.id,
          },
        });
        await tx.activity.create({
          data: {
            businessId: input.businessId,
            leadId: created.id,
            type: 'lead.created',
            data: { source: 'website_form', contactReused: Boolean(existing) },
          },
        });
        await recordAudit(tx, {
          action: 'lead.created',
          businessId: input.businessId,
          entityType: 'lead',
          entityId: created.id,
          metadata: { source: 'website_form' },
        });
        return created;
      });
      return { lead: toLeadDto(lead), created: true };
    } catch (err) {
      // Two identical submissions racing: the second hits the unique key → return the first.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const again = await this.findByIdempotencyKey(input.siteId, input.idempotencyKey);
        if (again) return { lead: again, created: false };
      }
      throw err;
    }
  }

  private async findByIdempotencyKey(siteId: string, idempotencyKey: string): Promise<Lead | null> {
    const sub = await this.prisma.formSubmission.findUnique({
      where: { siteId_idempotencyKey: { siteId, idempotencyKey } },
      select: { lead: { include: leadInclude } },
    });
    return sub ? toLeadDto(sub.lead) : null;
  }

  /** Leads this member may see: everything for owner/manager, only assigned for employees. */
  private visible(ctx: TenantContext): Prisma.LeadWhereInput {
    return {
      businessId: ctx.businessId,
      ...(can(ctx.role, 'leads.view.all') ? {} : { ownerId: ctx.userId }),
    };
  }

  private async findVisible(ctx: TenantContext, leadId: string, db: Db = this.prisma) {
    const lead = /^[0-9a-f-]{36}$/i.test(leadId)
      ? await db.lead.findFirst({
          where: { id: leadId, ...this.visible(ctx) },
          include: leadInclude,
        })
      : null;
    if (!lead) throw new AppError('NOT_FOUND');
    return lead;
  }

  /** Newest first, with search (name / phone / email) and filters. */
  async list(ctx: TenantContext, query: ListQuery = {}): Promise<Lead[]> {
    const q = query.q?.trim();
    const digits = q?.replace(/\D/g, '') ?? '';
    const phone = q ? normalizeIsraeliPhone(q) : null;
    const search: Prisma.LeadWhereInput | undefined = q
      ? {
          contact: {
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { email: { contains: q, mode: 'insensitive' } },
              ...(phone ? [{ phone }] : []),
              // "050-123" → match the national digits inside the stored E.164 number.
              ...(digits.length >= 3 ? [{ phone: { contains: digits.replace(/^0/, '') } }] : []),
            ],
          },
        }
      : undefined;
    const rows = await this.prisma.lead.findMany({
      where: {
        AND: [
          this.visible(ctx),
          ...(search ? [search] : []),
          ...(query.stageId ? [{ stageId: query.stageId }] : []),
          ...(query.ownerId === 'none'
            ? [{ ownerId: null }]
            : query.ownerId
              ? [{ ownerId: query.ownerId }]
              : []),
          ...(query.source ? [{ source: query.source }] : []),
        ],
      },
      include: leadInclude,
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    return rows.map(toLeadDto);
  }

  async pipeline(ctx: TenantContext): Promise<PipelineStage[]> {
    const stages = await ensureStages(this.prisma, ctx.businessId);
    return stages.map((s) => ({ id: s.id, name: s.name, position: s.position, kind: s.kind }));
  }

  async detail(
    ctx: TenantContext,
    leadId: string,
  ): Promise<{ lead: Lead; activities: Activity[] }> {
    const lead = await this.findVisible(ctx, leadId);
    const rows = await this.prisma.activity.findMany({
      where: { businessId: ctx.businessId, leadId: lead.id },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const actorIds = [...new Set(rows.map((r) => r.actorId).filter((x): x is string => !!x))];
    const actors = new Map(
      (
        await this.prisma.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, fullName: true },
        })
      ).map((u) => [u.id, u.fullName]),
    );
    const activities = rows
      .filter((r) => (ACTIVITY_TYPES as readonly string[]).includes(r.type))
      .map((r) => ({
        id: r.id,
        type: r.type as Activity['type'],
        data: (r.data ?? {}) as Record<string, unknown>,
        actor: r.actorId ? { id: r.actorId, name: actors.get(r.actorId) ?? '' } : null,
        createdAt: r.createdAt.toISOString(),
      }));
    return { lead: toLeadDto(lead), activities };
  }

  private async requireStage(db: Db, businessId: string, stageId: string) {
    const stage = await db.pipelineStage.findFirst({ where: { id: stageId, businessId } });
    if (!stage)
      throw new AppError('VALIDATION_ERROR', crmMessages.stageInvalid, {
        stageId: crmMessages.stageInvalid,
      });
    return stage;
  }

  private async requireMember(db: Db, businessId: string, userId: string) {
    const m = await db.membership.findFirst({
      where: { businessId, userId, status: 'ACTIVE' },
      select: { user: { select: { id: true, fullName: true } } },
    });
    if (!m)
      throw new AppError('VALIDATION_ERROR', crmMessages.ownerInvalid, {
        ownerId: crmMessages.ownerInvalid,
      });
    return m.user;
  }

  /** Manual lead. Employees' leads are assigned to themselves; the contact is reused by phone/email. */
  async create(ctx: TenantContext, input: CreateInput): Promise<Lead> {
    const canAssign = can(ctx.role, 'leads.assign');
    if (
      input.ownerId !== undefined &&
      input.ownerId !== null &&
      !canAssign &&
      input.ownerId !== ctx.userId
    ) {
      throw new AppError('FORBIDDEN');
    }
    const lead = await this.prisma.$transaction(async (tx) => {
      const stages = await ensureStages(tx, ctx.businessId);
      const stage = input.stageId
        ? await this.requireStage(tx, ctx.businessId, input.stageId)
        : stages[0]!;
      const ownerId = canAssign ? (input.ownerId ?? null) : ctx.userId;
      if (ownerId) await this.requireMember(tx, ctx.businessId, ownerId);

      const existing = await tx.contact.findFirst({
        where: {
          businessId: ctx.businessId,
          OR: [
            ...(input.phone ? [{ phone: input.phone }] : []),
            ...(input.email ? [{ email: input.email }] : []),
          ],
        },
        orderBy: { createdAt: 'asc' },
      });
      const contact =
        existing ??
        (await tx.contact.create({
          data: {
            businessId: ctx.businessId,
            name: input.name,
            phone: input.phone ?? null,
            email: input.email ?? null,
          },
        }));
      const created = await tx.lead.create({
        data: {
          businessId: ctx.businessId,
          contactId: contact.id,
          stageId: stage.id,
          ownerId,
          source: 'manual',
          message: input.message,
          expectedValue: input.expectedValue ?? null,
        },
        include: leadInclude,
      });
      await tx.activity.create({
        data: {
          businessId: ctx.businessId,
          leadId: created.id,
          type: 'lead.created',
          actorId: ctx.userId,
          data: { source: 'manual', contactReused: Boolean(existing) },
        },
      });
      await recordAudit(tx, {
        action: 'lead.created',
        businessId: ctx.businessId,
        actorUserId: ctx.userId,
        entityType: 'lead',
        entityId: created.id,
        metadata: { source: 'manual' },
      });
      return created;
    });
    return toLeadDto(lead);
  }

  /** Updates a visible lead; stage moves, assignments and field edits each land in the history. */
  async update(ctx: TenantContext, leadId: string, input: UpdateInput): Promise<Lead> {
    if (input.ownerId !== undefined && !can(ctx.role, 'leads.assign'))
      throw new AppError('FORBIDDEN');
    const updated = await this.prisma.$transaction(async (tx) => {
      const lead = await this.findVisible(ctx, leadId, tx);
      const data: Prisma.LeadUncheckedUpdateInput = {};
      const activities: { type: Activity['type']; data: Prisma.InputJsonObject }[] = [];

      if (input.stageId !== undefined && input.stageId !== lead.stageId) {
        const stage = await this.requireStage(tx, ctx.businessId, input.stageId);
        data.stageId = stage.id;
        activities.push({
          type: 'lead.stage_changed',
          data: { from: lead.stage.name, to: stage.name, toKind: stage.kind },
        });
      }
      if (input.ownerId !== undefined && input.ownerId !== lead.ownerId) {
        const owner = input.ownerId
          ? await this.requireMember(tx, ctx.businessId, input.ownerId)
          : null;
        data.ownerId = owner?.id ?? null;
        activities.push({ type: 'lead.assigned', data: { to: owner?.fullName ?? null } });
      }
      const changed: string[] = [];
      if (input.expectedValue !== undefined && input.expectedValue !== lead.expectedValue) {
        data.expectedValue = input.expectedValue;
        changed.push('expectedValue');
      }
      if (input.nextActionAt !== undefined) {
        const next = input.nextActionAt ? new Date(input.nextActionAt) : null;
        if ((next?.getTime() ?? null) !== (lead.nextActionAt?.getTime() ?? null)) {
          data.nextActionAt = next;
          changed.push('nextActionAt');
        }
      }
      if (input.message !== undefined && input.message !== lead.message) {
        data.message = input.message;
        changed.push('message');
      }
      if (changed.length) activities.push({ type: 'lead.updated', data: { fields: changed } });
      if (activities.length === 0) return lead;

      const row = await tx.lead.update({ where: { id: lead.id }, data, include: leadInclude });
      await tx.activity.createMany({
        data: activities.map((a) => ({
          businessId: ctx.businessId,
          leadId: lead.id,
          actorId: ctx.userId,
          type: a.type,
          data: a.data,
        })),
      });
      if (data.ownerId !== undefined) {
        await recordAudit(tx, {
          action: 'lead.assigned',
          businessId: ctx.businessId,
          actorUserId: ctx.userId,
          entityType: 'lead',
          entityId: lead.id,
        });
      }
      return row;
    });
    return toLeadDto(updated);
  }

  async addNote(ctx: TenantContext, leadId: string, text: string): Promise<Activity> {
    const lead = await this.findVisible(ctx, leadId);
    const row = await this.prisma.activity.create({
      data: {
        businessId: ctx.businessId,
        leadId: lead.id,
        actorId: ctx.userId,
        type: 'lead.note',
        data: { text },
      },
    });
    const actor = await this.prisma.user.findUnique({
      where: { id: ctx.userId },
      select: { fullName: true },
    });
    return {
      id: row.id,
      type: 'lead.note',
      data: { text },
      actor: { id: ctx.userId, name: actor?.fullName ?? '' },
      createdAt: row.createdAt.toISOString(),
    };
  }

  /**
   * Existing contacts with this phone or email (duplicate warning before creating a lead).
   * Only for members who can see all leads; employees get an empty list (the server still reuses
   * the contact), so the check can't be used to discover other people's leads.
   */
  async duplicates(
    ctx: TenantContext,
    phone?: string,
    email?: string,
  ): Promise<DuplicateContact[]> {
    if (!can(ctx.role, 'leads.view.all')) return [];
    const e164 = phone ? normalizeIsraeliPhone(phone) : null;
    const mail = email?.trim().toLowerCase() || null;
    if (!e164 && !mail) return [];
    const rows = await this.prisma.contact.findMany({
      where: {
        businessId: ctx.businessId,
        OR: [...(e164 ? [{ phone: e164 }] : []), ...(mail ? [{ email: mail }] : [])],
      },
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        _count: { select: { leads: true } },
      },
      take: 5,
    });
    return rows.map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      email: c.email,
      leadCount: c._count.leads,
    }));
  }
}
