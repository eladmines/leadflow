import { Prisma, type PrismaClient } from '@prisma/client';
import { can, DEFAULT_PIPELINE_STAGES, type Lead, type LeadSubmission } from '@leadflow/shared';
import type { Db } from '../../lib/db';
import type { TenantContext } from '../../plugins/tenant';
import { recordAudit } from '../audit/service';

const leadInclude = {
  contact: { select: { id: true, name: true, phone: true, email: true } },
  stage: { select: { id: true, name: true, kind: true } },
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
    createdAt: row.createdAt.toISOString(),
  };
}

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

  /** Newest first. Employees only see leads assigned to them (PRD §20). */
  async list(ctx: TenantContext): Promise<Lead[]> {
    const rows = await this.prisma.lead.findMany({
      where: {
        businessId: ctx.businessId,
        ...(can(ctx.role, 'leads.view.all') ? {} : { ownerId: ctx.userId }),
      },
      include: leadInclude,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map(toLeadDto);
  }
}
