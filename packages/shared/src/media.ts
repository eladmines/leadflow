import { z } from 'zod';

/**
 * F05 — Media. Images are uploaded through the API, fully decoded and re-encoded (WebP, max
 * 1920 px, EXIF stripped), stored under an unguessable key and served from `MEDIA_PATH` on the
 * same origin as the page (admin preview and the public site), or from a CDN in production.
 */
export const MEDIA_PATH = '/media';
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_IMAGE_EDGE = 1920;

export const mediaMessages = {
  tooLarge: 'הקובץ גדול מדי (עד 8MB)',
  wrongType: 'אפשר להעלות רק תמונות JPG, PNG או WebP',
  unreadable: 'לא הצלחנו לקרוא את התמונה. נסו קובץ אחר',
  quotaExceeded: 'נגמר מקום האחסון של העסק. מחקו תמונות שלא בשימוש',
  inUse: 'התמונה בשימוש באתר. הסירו אותה מהאתר לפני המחיקה',
  foreignAsset: 'אחת התמונות אינה שייכת לעסק',
  noFile: 'לא נבחר קובץ',
} as const;

export const assetSchema = z.object({
  id: z.string().uuid(),
  url: z.string(),
  width: z.number().int(),
  height: z.number().int(),
  sizeBytes: z.number().int(),
  originalName: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type Asset = z.infer<typeof assetSchema>;

export const assetResponseSchema = z.object({ asset: assetSchema });
export const assetListResponseSchema = z.object({
  assets: z.array(assetSchema),
  usedBytes: z.number().int(),
  quotaBytes: z.number().int(),
});
export type AssetListResponse = z.infer<typeof assetListResponseSchema>;

export const mediaApiPaths = {
  assets: (businessId: string) => `/api/v1/businesses/${businessId}/assets`,
  asset: (businessId: string, assetId: string) =>
    `/api/v1/businesses/${businessId}/assets/${assetId}`,
} as const;

/** Every asset id a site draft references (theme logo, hero/about images, gallery). */
export function referencedAssetIds(draft: {
  theme: { logoAssetId?: string | null };
  sections: unknown[];
}): string[] {
  const ids = new Set<string>();
  if (draft.theme.logoAssetId) ids.add(draft.theme.logoAssetId);
  for (const s of draft.sections as Array<Record<string, unknown>>) {
    if (typeof s.imageAssetId === 'string') ids.add(s.imageAssetId);
    if (s.type === 'gallery' && Array.isArray(s.items)) {
      for (const i of s.items as Array<{ assetId?: unknown }>)
        if (typeof i.assetId === 'string') ids.add(i.assetId);
    }
  }
  return [...ids];
}
