import { randomUUID } from 'node:crypto';
import type { Asset as AssetRow, PrismaClient } from '@prisma/client';
import { mediaMessages, referencedAssetIds, type Asset, type MediaMap } from '@leadflow/shared';
import type { AppConfig } from '../../config/env';
import type { StorageProvider } from '../../integrations/storage';
import type { Db } from '../../lib/db';
import { AppError } from '../../lib/errors';
import { processImage } from '../../lib/images';
import type { TenantContext } from '../../plugins/tenant';

export const assetUrl = (config: AppConfig, key: string) => `${config.MEDIA_PUBLIC_BASE}/${key}`;

export class MediaService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: StorageProvider,
    private readonly config: AppConfig,
  ) {}

  private dto(a: AssetRow): Asset {
    return {
      id: a.id,
      url: assetUrl(this.config, a.key),
      width: a.width,
      height: a.height,
      sizeBytes: a.sizeBytes,
      originalName: a.originalName,
      createdAt: a.createdAt.toISOString(),
    };
  }

  async list(ctx: TenantContext) {
    const rows = await this.prisma.asset.findMany({
      where: { businessId: ctx.businessId },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    const used = await this.prisma.asset.aggregate({
      where: { businessId: ctx.businessId },
      _sum: { sizeBytes: true },
    });
    return {
      assets: rows.map((r) => this.dto(r)),
      usedBytes: used._sum.sizeBytes ?? 0,
      quotaBytes: this.config.MEDIA_QUOTA_BYTES,
    };
  }

  async upload(ctx: TenantContext, file: Buffer, originalName: string | null): Promise<Asset> {
    const image = await processImage(file);
    const used = await this.prisma.asset.aggregate({
      where: { businessId: ctx.businessId },
      _sum: { sizeBytes: true },
    });
    if ((used._sum.sizeBytes ?? 0) + image.data.length > this.config.MEDIA_QUOTA_BYTES) {
      throw new AppError('CONFLICT', mediaMessages.quotaExceeded);
    }
    const id = randomUUID();
    const key = `${ctx.businessId}/${id}.webp`;
    await this.storage.put(key, image.data, image.mime);
    try {
      const row = await this.prisma.asset.create({
        data: {
          id,
          businessId: ctx.businessId,
          key,
          mime: image.mime,
          sizeBytes: image.data.length,
          width: image.width,
          height: image.height,
          originalName: originalName?.slice(0, 200) ?? null,
          createdById: ctx.userId,
        },
      });
      return this.dto(row);
    } catch (err) {
      await this.storage.delete(key).catch(() => undefined);
      throw err;
    }
  }

  /** Refuses while the image is used by the draft or the live version (a deletion would break it). */
  async remove(ctx: TenantContext, assetId: string) {
    const asset = /^[0-9a-f-]{36}$/i.test(assetId)
      ? await this.prisma.asset.findFirst({ where: { id: assetId, businessId: ctx.businessId } })
      : null;
    if (!asset) throw new AppError('NOT_FOUND');
    const site = await this.prisma.site.findUnique({
      where: { businessId: ctx.businessId },
      select: {
        theme: true,
        sections: true,
        pages: true,
        publishedVersion: { select: { content: true } },
      },
    });
    const inDraft = site
      ? referencedAssetIds({
          theme: site.theme as { logoAssetId?: string },
          sections: site.sections as unknown[],
          pages: site.pages as { sections: unknown[] }[],
        })
      : [];
    const live = site?.publishedVersion?.content as
      | {
          theme?: { logoAssetId?: string };
          sections?: unknown[];
          pages?: { sections: unknown[] }[];
        }
      | undefined;
    const inLive =
      live?.theme && live.sections
        ? referencedAssetIds({ theme: live.theme, sections: live.sections, pages: live.pages })
        : [];
    if (inDraft.includes(asset.id) || inLive.includes(asset.id)) {
      throw new AppError('CONFLICT', mediaMessages.inUse);
    }
    await this.prisma.asset.delete({ where: { id: asset.id } });
    await this.storage.delete(asset.key).catch(() => undefined);
  }
}

/** Every referenced id must be an asset of this business (no borrowing another tenant's images). */
export async function assertOwnAssets(db: Db, businessId: string, ids: string[]) {
  if (ids.length === 0) return;
  const count = await db.asset.count({ where: { businessId, id: { in: ids } } });
  if (count !== ids.length) throw new AppError('VALIDATION_ERROR', mediaMessages.foreignAsset);
}

/** Resolves ids to URLs + sizes for rendering (only this business's assets). */
export async function mediaMapFor(
  db: Db,
  config: AppConfig,
  businessId: string,
  ids: string[],
): Promise<MediaMap> {
  if (ids.length === 0) return {};
  const rows = await db.asset.findMany({ where: { businessId, id: { in: ids } } });
  return Object.fromEntries(
    rows.map((r) => [r.id, { url: assetUrl(config, r.key), width: r.width, height: r.height }]),
  );
}
