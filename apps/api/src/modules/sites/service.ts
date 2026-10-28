import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Prisma, type PrismaClient, type Site as SiteRow, type SiteVersion } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import {
  buildTemplateDraft,
  STOCK_PHOTOS,
  withTemplatePhotos,
  openingHoursSchema,
  referencedAssetIds,
  renderSitePage,
  sectionSchema,
  sitePageSchema,
  seoSchema,
  siteMessages,
  templateKeySchema,
  themeSchema,
  type SaveDraftRequest,
  type Site,
  type SiteBusinessInfo,
  type SiteVersion as SiteVersionDto,
  type TemplateKey,
} from '@leadflow/shared';
import { z } from 'zod';
import type { AppConfig } from '../../config/env';
import { AppError } from '../../lib/errors';
import type { TenantContext } from '../../plugins/tenant';
import { recordAudit } from '../audit/service';
import { assertOwnAssets, mediaMapFor, type MediaService } from '../media/service';
import type { PublishedSiteCache } from '../../public/cache';

const storedSections = z.array(sectionSchema);
const storedPages = z.array(sitePageSchema).catch([]);
type SiteWithLive = SiteRow & { publishedVersion: SiteVersion | null };

export function publicUrlFor(config: AppConfig, subdomain: string) {
  return `${config.PUBLIC_SITE_PROTOCOL}://${subdomain}.${config.PUBLIC_SITE_HOST}`;
}

/** Maps a row to the API shape, re-validating stored JSON (never trust what's in the DB blindly). */
export function toSiteDto(row: SiteWithLive, config: AppConfig): Site {
  const live = row.publishedVersion;
  return {
    id: row.id,
    subdomain: row.subdomain,
    publicUrl: row.subdomain ? publicUrlFor(config, row.subdomain) : null,
    publicDomain: config.PUBLIC_SITE_HOST,
    published: live
      ? {
          versionId: live.id,
          number: live.number,
          revision: live.draftRevision,
          publishedAt: live.createdAt.toISOString(),
        }
      : null,
    templateKey: templateKeySchema.parse(row.templateKey),
    theme: themeSchema.parse(row.theme),
    seo: seoSchema.parse(row.seo),
    sections: storedSections.parse(row.sections),
    pages: storedPages.parse(row.pages),
    revision: row.revision,
    status: row.status,
    updatedAt: row.updatedAt.toISOString(),
  };
}

const withLive = { publishedVersion: true } as const;

export class SiteService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: AppConfig,
    private readonly log: FastifyBaseLogger,
    private readonly cache: PublishedSiteCache,
    private readonly media?: MediaService,
  ) {}

  /**
   * Copies the template's sample photos into the business's media library (D-069), so the owner
   * can replace or delete them like any upload. Best effort: a new site never fails over photos.
   */
  private async importStockPhotos(ctx: TenantContext, templateKey: TemplateKey) {
    if (!this.media || !this.config.SITE_STOCK_IMAGES) return {};
    const ids: { hero?: string; about?: string } = {};
    for (const slot of ['hero', 'about'] as const) {
      const photo = STOCK_PHOTOS[templateKey][slot];
      try {
        const file = await readFile(path.resolve(this.config.SITE_STOCK_DIR, photo.file));
        ids[slot] = (await this.media.upload(ctx, file, `תמונה לדוגמה (${photo.file})`)).id;
      } catch (err) {
        this.log.warn({ errName: (err as Error)?.name, file: photo.file }, 'stock photo skipped');
      }
    }
    return ids;
  }

  private dto(row: SiteWithLive) {
    return toSiteDto(row, this.config);
  }

  private async requireSite(ctx: TenantContext): Promise<SiteWithLive> {
    const row = await this.prisma.site.findUnique({
      where: { businessId: ctx.businessId },
      include: withLive,
    });
    if (!row) throw new AppError('NOT_FOUND');
    return row;
  }

  async get(ctx: TenantContext): Promise<Site | null> {
    const row = await this.prisma.site.findUnique({
      where: { businessId: ctx.businessId },
      include: withLive,
    });
    return row ? this.dto(row) : null;
  }

  /** Creates the business's site from a template, pre-filled with the business profile. */
  async create(ctx: TenantContext, templateKey: TemplateKey): Promise<Site> {
    const business = await this.prisma.business.findUniqueOrThrow({
      where: { id: ctx.businessId },
    });
    if (await this.prisma.site.findUnique({ where: { businessId: ctx.businessId } })) {
      throw new AppError('CONFLICT', siteMessages.siteExists);
    }
    const base = buildTemplateDraft(templateKey, {
      name: business.name,
      industry: business.industry,
      phone: business.phone,
      address: business.address,
      serviceAreas: business.serviceAreas,
      openingHours: null,
    });
    const draft = withTemplatePhotos(base, await this.importStockPhotos(ctx, templateKey));
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
          include: withLive,
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
      return this.dto(row);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new AppError('CONFLICT', siteMessages.siteExists);
      }
      throw err;
    }
  }

  /**
   * Replaces the draft only if the client saw the latest revision (optimistic locking), so two
   * open editors can never silently overwrite each other. Never touches the published version.
   */
  async saveDraft(ctx: TenantContext, input: SaveDraftRequest): Promise<Site> {
    await assertOwnAssets(this.prisma, ctx.businessId, referencedAssetIds(input));
    const result = await this.prisma.site.updateMany({
      where: { businessId: ctx.businessId, revision: input.revision },
      data: {
        templateKey: input.templateKey,
        theme: input.theme,
        seo: input.seo,
        sections: input.sections as unknown as Prisma.InputJsonArray,
        pages: input.pages as unknown as Prisma.InputJsonArray,
        revision: { increment: 1 },
      },
    });
    if (result.count === 0) {
      await this.requireSite(ctx);
      throw new AppError('CONFLICT', siteMessages.revisionConflict);
    }
    return this.dto(await this.requireSite(ctx));
  }

  async setSubdomain(ctx: TenantContext, subdomain: string): Promise<Site> {
    const site = await this.requireSite(ctx);
    if (site.subdomain === subdomain) return this.dto(site);
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.site.update({
          where: { id: site.id },
          data: { subdomain },
          include: withLive,
        });
        await recordAudit(tx, {
          action: 'site.subdomain.changed',
          businessId: ctx.businessId,
          actorUserId: ctx.userId,
          entityType: 'site',
          entityId: site.id,
          metadata: { from: site.subdomain, to: subdomain },
        });
        return updated;
      });
      this.cache.invalidate(site.subdomain, subdomain);
      return this.dto(row);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new AppError('CONFLICT', siteMessages.subdomainTaken, {
          subdomain: siteMessages.subdomainTaken,
        });
      }
      throw err;
    }
  }

  /**
   * Renders the draft at `revision` into an immutable version and makes it live, atomically.
   * Rendering happens before the transaction; any failure leaves the current live version as is.
   */
  async publish(ctx: TenantContext, revision: number): Promise<Site> {
    const site = await this.requireSite(ctx);
    if (!site.subdomain) {
      throw new AppError('VALIDATION_ERROR', siteMessages.subdomainRequired, {
        subdomain: siteMessages.subdomainRequired,
      });
    }
    if (site.revision !== revision) throw new AppError('CONFLICT', siteMessages.publishStale);

    const business = await this.prisma.business.findUniqueOrThrow({
      where: { id: ctx.businessId },
    });
    const hours = openingHoursSchema.safeParse(business.openingHours);
    const info: SiteBusinessInfo = {
      name: business.name,
      industry: business.industry,
      phone: business.phone,
      address: business.address,
      serviceAreas: business.serviceAreas,
      openingHours: hours.success ? hours.data : null,
      // Offered in the appointment request (F17); a later change takes effect on republish.
      services: await this.prisma.service.findMany({
        where: { businessId: ctx.businessId, active: true },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
    };
    const draft = {
      theme: themeSchema.parse(site.theme),
      seo: seoSchema.parse(site.seo),
      sections: storedSections.parse(site.sections),
      pages: storedPages.parse(site.pages),
    };
    const media = await mediaMapFor(
      this.prisma,
      this.config,
      ctx.businessId,
      referencedAssetIds(draft),
    );
    const html = renderSitePage(draft, info, media);
    // Every extra page is rendered now too, so the whole site goes live together (D-081).
    const pageHtml = Object.fromEntries(
      draft.pages.map((p) => [p.slug, renderSitePage(draft, info, media, { page: p.slug })]),
    );

    try {
      const row = await this.prisma.$transaction(async (tx) => {
        // Re-check the revision inside the transaction: a save may have landed meanwhile.
        const fresh = await tx.site.findUniqueOrThrow({ where: { id: site.id } });
        if (fresh.revision !== revision) throw new AppError('CONFLICT', siteMessages.publishStale);
        const last = await tx.siteVersion.aggregate({
          where: { siteId: site.id },
          _max: { number: true },
        });
        const version = await tx.siteVersion.create({
          data: {
            businessId: ctx.businessId,
            siteId: site.id,
            number: (last._max.number ?? 0) + 1,
            draftRevision: revision,
            html,
            pageHtml,
            content: { ...draft, business: info } as unknown as Prisma.InputJsonObject,
            createdById: ctx.userId,
          },
        });
        const updated = await tx.site.update({
          where: { id: site.id },
          data: { publishedVersionId: version.id, status: 'PUBLISHED' },
          include: withLive,
        });
        await recordAudit(tx, {
          action: 'site.published',
          businessId: ctx.businessId,
          actorUserId: ctx.userId,
          entityType: 'site_version',
          entityId: version.id,
          metadata: { number: version.number },
        });
        return updated;
      });
      this.cache.invalidate(site.subdomain);
      this.log.info({ businessId: ctx.businessId, siteId: site.id }, 'site published');
      return this.dto(row);
    } catch (err) {
      // Two publishes racing for the same version number: the loser retries by hand.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new AppError('CONFLICT', siteMessages.publishStale);
      }
      throw err;
    }
  }

  async listVersions(ctx: TenantContext): Promise<SiteVersionDto[]> {
    const site = await this.requireSite(ctx);
    const versions = await this.prisma.siteVersion.findMany({
      where: { siteId: site.id, businessId: ctx.businessId },
      select: {
        id: true,
        number: true,
        createdAt: true,
        createdBy: { select: { fullName: true } },
      },
      orderBy: { number: 'desc' },
      take: 50,
    });
    return versions.map((v) => ({
      id: v.id,
      number: v.number,
      publishedAt: v.createdAt.toISOString(),
      publishedBy: v.createdBy?.fullName ?? null,
      live: v.id === site.publishedVersionId,
    }));
  }

  /** Makes an earlier version live again. The version must belong to this business's site. */
  async rollback(ctx: TenantContext, versionId: string): Promise<Site> {
    const site = await this.requireSite(ctx);
    const version = z.string().uuid().safeParse(versionId).success
      ? await this.prisma.siteVersion.findFirst({
          where: { id: versionId, siteId: site.id, businessId: ctx.businessId },
        })
      : null;
    if (!version) throw new AppError('NOT_FOUND');
    if (!site.subdomain) throw new AppError('VALIDATION_ERROR', siteMessages.subdomainRequired);

    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.site.update({
        where: { id: site.id },
        data: { publishedVersionId: version.id, status: 'PUBLISHED' },
        include: withLive,
      });
      await recordAudit(tx, {
        action: 'site.rolled_back',
        businessId: ctx.businessId,
        actorUserId: ctx.userId,
        entityType: 'site_version',
        entityId: version.id,
        metadata: { number: version.number },
      });
      return updated;
    });
    this.cache.invalidate(site.subdomain);
    return this.dto(row);
  }

  /** Takes the site offline. Versions are kept; publishing again brings it back. */
  async unpublish(ctx: TenantContext): Promise<Site> {
    const site = await this.requireSite(ctx);
    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.site.update({
        where: { id: site.id },
        data: { publishedVersionId: null, status: 'DRAFT' },
        include: withLive,
      });
      await recordAudit(tx, {
        action: 'site.unpublished',
        businessId: ctx.businessId,
        actorUserId: ctx.userId,
        entityType: 'site',
        entityId: site.id,
      });
      return updated;
    });
    this.cache.invalidate(site.subdomain);
    return this.dto(row);
  }
}
