import { Prisma, type PrismaClient, type Site as SiteRow } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import {
  buildTemplateDraft,
  sectionSchema,
  seoSchema,
  siteMessages,
  templateKeySchema,
  themeSchema,
  type SaveDraftRequest,
  type Site,
  type TemplateKey,
} from '@leadflow/shared';
import { z } from 'zod';
import { AppError } from '../../lib/errors';
import type { TenantContext } from '../../plugins/tenant';
import { recordAudit } from '../audit/service';

const storedSections = z.array(sectionSchema);

/** Maps a row to the API shape, re-validating stored JSON (never trust what's in the DB blindly). */
export function toSiteDto(row: SiteRow): Site {
  return {
    id: row.id,
    templateKey: templateKeySchema.parse(row.templateKey),
    theme: themeSchema.parse(row.theme),
    seo: seoSchema.parse(row.seo),
    sections: storedSections.parse(row.sections),
    revision: row.revision,
    status: row.status,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class SiteService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly log: FastifyBaseLogger,
  ) {}

  async get(ctx: TenantContext): Promise<Site | null> {
    const row = await this.prisma.site.findUnique({ where: { businessId: ctx.businessId } });
    return row ? toSiteDto(row) : null;
  }

  /** Creates the business's site from a template, pre-filled with the business profile. */
  async create(ctx: TenantContext, templateKey: TemplateKey): Promise<Site> {
    const business = await this.prisma.business.findUniqueOrThrow({
      where: { id: ctx.businessId },
    });
    const draft = buildTemplateDraft(templateKey, {
      name: business.name,
      industry: business.industry,
      phone: business.phone,
      address: business.address,
      serviceAreas: business.serviceAreas,
      openingHours: null,
    });
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const created = await tx.site.create({
          data: {
            businessId: ctx.businessId,
            templateKey,
            theme: draft.theme,
            seo: draft.seo,
            sections: draft.sections as unknown as Prisma.InputJsonArray,
          },
        });
        await recordAudit(tx, {
          action: 'site.created',
          businessId: ctx.businessId,
          actorUserId: ctx.userId,
          entityType: 'site',
          entityId: created.id,
          metadata: { templateKey },
        });
        return created;
      });
      return toSiteDto(row);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new AppError('CONFLICT', siteMessages.siteExists);
      }
      throw err;
    }
  }

  /**
   * Replaces the draft only if the client saw the latest revision (optimistic locking), so two
   * open editors can never silently overwrite each other. Never touches the published site.
   */
  async saveDraft(ctx: TenantContext, input: SaveDraftRequest): Promise<Site> {
    const result = await this.prisma.site.updateMany({
      where: { businessId: ctx.businessId, revision: input.revision },
      data: {
        templateKey: input.templateKey,
        theme: input.theme,
        seo: input.seo,
        sections: input.sections as unknown as Prisma.InputJsonArray,
        revision: { increment: 1 },
      },
    });
    if (result.count === 0) {
      const exists = await this.prisma.site.count({ where: { businessId: ctx.businessId } });
      if (!exists) throw new AppError('NOT_FOUND');
      throw new AppError('CONFLICT', siteMessages.revisionConflict);
    }
    const row = await this.prisma.site.findUniqueOrThrow({ where: { businessId: ctx.businessId } });
    this.log.debug({ businessId: ctx.businessId, revision: row.revision }, 'site draft saved');
    return toSiteDto(row);
  }
}
