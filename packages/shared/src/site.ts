import { z } from 'zod';

/**
 * F04 — Site builder contract (single-page site in the MVP, D-030).
 * The draft lives on the Site row; publishing (F06) snapshots it into immutable versions.
 */

// ---------------------------------------------------------------------------
// Limits & messages
// ---------------------------------------------------------------------------

export const SITE_LIMITS = {
  sections: 20,
  items: 20,
  title: 120,
  shortText: 300,
  body: 2000,
  price: 40,
} as const;

export const siteMessages = {
  titleTooLong: `הכותרת יכולה להכיל עד ${SITE_LIMITS.title} תווים`,
  textTooLong: `הטקסט יכול להכיל עד ${SITE_LIMITS.shortText} תווים`,
  bodyTooLong: `הטקסט יכול להכיל עד ${SITE_LIMITS.body} תווים`,
  priceTooLong: `המחיר יכול להכיל עד ${SITE_LIMITS.price} תווים`,
  tooManyItems: `אפשר להוסיף עד ${SITE_LIMITS.items} פריטים`,
  tooManySections: `אפשר להוסיף עד ${SITE_LIMITS.sections} מקטעים`,
  required: 'שדה חובה',
  revisionConflict: 'האתר נערך בינתיים בחלון אחר. טענו מחדש כדי לראות את הגרסה העדכנית.',
  siteExists: 'לעסק כבר יש אתר',
} as const;

const title = z.string().trim().max(SITE_LIMITS.title, siteMessages.titleTooLong);
const short = z.string().trim().max(SITE_LIMITS.shortText, siteMessages.textTooLong);
const body = z.string().trim().max(SITE_LIMITS.body, siteMessages.bodyTooLong);
const price = z.string().trim().max(SITE_LIMITS.price, siteMessages.priceTooLong);
const items = <T extends z.ZodTypeAny>(item: T) =>
  z.array(item).max(SITE_LIMITS.items, siteMessages.tooManyItems);

/** Client-generated id (stable across saves, used as React key and for in-page anchors). */
const sectionId = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);
const base = { id: sectionId, visible: z.boolean() };

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

export const SECTION_TYPES = [
  'hero',
  'about',
  'services',
  'pricing',
  'testimonials',
  'faq',
  'contact',
  'cta',
] as const;
export type SectionType = (typeof SECTION_TYPES)[number];

export const sectionTypeLabels: Record<SectionType, string> = {
  hero: 'כותרת ראשית',
  about: 'אודות',
  services: 'שירותים',
  pricing: 'מחירון',
  testimonials: 'המלצות',
  faq: 'שאלות נפוצות',
  contact: 'יצירת קשר',
  cta: 'קריאה לפעולה',
};

export const HERO_ACTIONS = ['call', 'contact'] as const;
export const heroActionLabels: Record<(typeof HERO_ACTIONS)[number], string> = {
  call: 'חיוג לעסק',
  contact: 'מעבר ליצירת קשר',
};

export const sectionSchema = z.discriminatedUnion('type', [
  z.object({
    ...base,
    type: z.literal('hero'),
    title,
    subtitle: short,
    buttonLabel: z.string().trim().max(40, siteMessages.textTooLong),
    buttonAction: z.enum(HERO_ACTIONS),
  }),
  z.object({ ...base, type: z.literal('about'), title, body }),
  z.object({
    ...base,
    type: z.literal('services'),
    title,
    items: items(z.object({ name: title, description: short })),
  }),
  z.object({
    ...base,
    type: z.literal('pricing'),
    title,
    note: short,
    items: items(z.object({ name: title, price })),
  }),
  z.object({
    ...base,
    type: z.literal('testimonials'),
    title,
    items: items(
      z.object({ quote: short, author: z.string().trim().max(80, siteMessages.textTooLong) }),
    ),
  }),
  z.object({
    ...base,
    type: z.literal('faq'),
    title,
    items: items(z.object({ question: title, answer: short })),
  }),
  z.object({
    ...base,
    type: z.literal('contact'),
    title,
    subtitle: short,
    showPhone: z.boolean(),
    showAddress: z.boolean(),
    showHours: z.boolean(),
  }),
  z.object({
    ...base,
    type: z.literal('cta'),
    title,
    subtitle: short,
    buttonLabel: z.string().trim().max(40, siteMessages.textTooLong),
  }),
]);
export type Section = z.infer<typeof sectionSchema>;
export type SectionOf<T extends SectionType> = Extract<Section, { type: T }>;

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

/** Curated palettes (accessible contrast on white); no free colour picker in the MVP. */
export const PALETTES = {
  teal: { label: 'טורקיז', primary: '#1f6a66', accent: '#ec6640', soft: '#edf7f6' },
  rose: { label: 'ורוד עתיק', primary: '#9b2f52', accent: '#d98a5f', soft: '#fbf0f3' },
  navy: { label: 'כחול עמוק', primary: '#1d3b63', accent: '#e8962f', soft: '#eef3f9' },
  forest: { label: 'ירוק יער', primary: '#2f5d3a', accent: '#c98a2b', soft: '#f0f6f0' },
  plum: { label: 'שזיף', primary: '#5b2f73', accent: '#e07a8b', soft: '#f5f0f8' },
  graphite: { label: 'גרפיט', primary: '#2b3440', accent: '#e0a526', soft: '#f2f3f5' },
} as const;
export type PaletteKey = keyof typeof PALETTES;
export const PALETTE_KEYS = Object.keys(PALETTES) as [PaletteKey, ...PaletteKey[]];

export const FONTS = {
  rubik: { label: 'רוביק — עגול וידידותי', family: 'Rubik' },
  heebo: { label: 'חיבו — נקי ומודרני', family: 'Heebo' },
  assistant: { label: 'אסיסטנט — קליל', family: 'Assistant' },
  frank: { label: 'פרנק ריהל — קלאסי', family: 'Frank Ruhl Libre' },
} as const;
export type FontKey = keyof typeof FONTS;
export const FONT_KEYS = Object.keys(FONTS) as [FontKey, ...FontKey[]];

export const themeSchema = z.object({
  palette: z.enum(PALETTE_KEYS),
  font: z.enum(FONT_KEYS),
});
export type SiteTheme = z.infer<typeof themeSchema>;

export const seoSchema = z.object({
  title: z.string().trim().max(70, 'כותרת לגוגל יכולה להכיל עד 70 תווים'),
  description: z.string().trim().max(160, 'תיאור לגוגל יכול להכיל עד 160 תווים'),
});
export type SiteSeo = z.infer<typeof seoSchema>;

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

/** First templates (D-031 / O-002): beauty and trades. Other industries start from the closest. */
export const TEMPLATE_KEYS = ['beauty', 'trades'] as const;
export const templateKeySchema = z.enum(TEMPLATE_KEYS);
export type TemplateKey = z.infer<typeof templateKeySchema>;

export const templateInfo: Record<TemplateKey, { label: string; description: string }> = {
  beauty: {
    label: 'יופי וטיפוח',
    description: 'למספרות, קוסמטיקה וסטודיו: שירותים, מחירון, המלצות וקביעת תור.',
  },
  trades: {
    label: 'בעלי מקצוע ושירות',
    description: 'לחשמלאים, אינסטלטורים, שיפוצים ומוסכים: שירותים, אזורי שירות ו"התקשרו עכשיו".',
  },
};

/** Suggested template for an industry (owners can pick either). */
export function templateForIndustry(industry: string): TemplateKey {
  return industry === 'beauty' || industry === 'studio' ? 'beauty' : 'trades';
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export const SITE_STATUSES = ['DRAFT', 'PUBLISHED', 'SUSPENDED'] as const;

export const siteSchema = z.object({
  id: z.string().uuid(),
  templateKey: templateKeySchema,
  theme: themeSchema,
  seo: seoSchema,
  sections: z.array(sectionSchema),
  /** Optimistic-locking counter: every successful draft save increments it. */
  revision: z.number().int(),
  status: z.enum(SITE_STATUSES),
  updatedAt: z.string().datetime(),
});
export type Site = z.infer<typeof siteSchema>;

export const siteResponseSchema = z.object({ site: siteSchema.nullable() });
export type SiteResponse = z.infer<typeof siteResponseSchema>;

export const createSiteRequestSchema = z.object({ templateKey: templateKeySchema });
export type CreateSiteRequest = z.infer<typeof createSiteRequestSchema>;

/** Full draft replace, guarded by the revision the client last saw (409 when stale). */
export const saveDraftRequestSchema = z.object({
  revision: z.number().int().min(0),
  templateKey: templateKeySchema,
  theme: themeSchema,
  seo: seoSchema,
  sections: z
    .array(sectionSchema)
    .max(SITE_LIMITS.sections, siteMessages.tooManySections)
    .refine((s) => new Set(s.map((x) => x.id)).size === s.length, 'מזהי מקטעים כפולים'),
});
export type SaveDraftRequest = z.infer<typeof saveDraftRequestSchema>;

export const siteApiPaths = {
  site: (businessId: string) => `/api/v1/businesses/${businessId}/site`,
  draft: (businessId: string) => `/api/v1/businesses/${businessId}/site/draft`,
} as const;
