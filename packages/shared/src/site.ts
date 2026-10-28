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
  /** Extra pages besides the home page (D-081). */
  pages: 10,
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
  subdomainRequired: 'יש לבחור כתובת לאתר',
  subdomainInvalid: 'אפשר להשתמש באותיות באנגלית, ספרות ומקף (3–40 תווים), בלי מקף בהתחלה או בסוף',
  subdomainReserved: 'הכתובת הזו שמורה למערכת. נסו כתובת אחרת',
  subdomainTaken: 'הכתובת הזו כבר תפוסה. נסו כתובת אחרת',
  publishStale: 'יש שינויים שעדיין נשמרים. נסו לפרסם שוב בעוד רגע',
  pageTitleRequired: 'יש לתת שם לעמוד',
  pageSlugInvalid: 'כתובת העמוד: אותיות באנגלית, ספרות ומקף (עד 40 תווים)',
  pageSlugReserved: 'הכתובת הזו שמורה למערכת. בחרו כתובת אחרת',
  pageSlugTaken: 'כבר יש עמוד בכתובת הזו',
  tooManyPages: `אפשר עד ${10} עמודים נוספים`,
} as const;

// ---------------------------------------------------------------------------
// Subdomain (F06)
// ---------------------------------------------------------------------------

/** Names that must never be a customer's subdomain (platform hosts and confusing words). */
export const RESERVED_SUBDOMAINS = new Set([
  'www',
  'app',
  'api',
  'admin',
  'administrator',
  'mail',
  'email',
  'smtp',
  'static',
  'assets',
  'cdn',
  'media',
  'files',
  'help',
  'support',
  'blog',
  'status',
  'docs',
  'dashboard',
  'login',
  'signin',
  'signup',
  'register',
  'account',
  'billing',
  'leadflow',
  'test',
  'dev',
  'staging',
  'preview',
  'public',
  'root',
  'system',
  'security',
  'abuse',
  'postmaster',
]);

/** Lowercase letters, digits and hyphens; 3–40 chars; no leading/trailing hyphen. */
export const subdomainSchema = z
  .string({ required_error: siteMessages.subdomainRequired })
  .trim()
  .toLowerCase()
  .min(1, siteMessages.subdomainRequired)
  .regex(/^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$/, siteMessages.subdomainInvalid)
  .refine((s) => !RESERVED_SUBDOMAINS.has(s), siteMessages.subdomainReserved);

const title = z.string().trim().max(SITE_LIMITS.title, siteMessages.titleTooLong);
const short = z.string().trim().max(SITE_LIMITS.shortText, siteMessages.textTooLong);
const body = z.string().trim().max(SITE_LIMITS.body, siteMessages.bodyTooLong);
const price = z.string().trim().max(SITE_LIMITS.price, siteMessages.priceTooLong);
const items = <T extends z.ZodTypeAny>(item: T) =>
  z.array(item).max(SITE_LIMITS.items, siteMessages.tooManyItems);

/** Client-generated id (stable across saves, used as React key and for in-page anchors). */
const sectionId = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);
const base = {
  id: sectionId,
  visible: z.boolean(),
  /** Short name in the site menu and above the title; empty = the type's default (D-075). */
  navLabel: z.string().trim().max(30, siteMessages.textTooLong).optional(),
  /** Look of this section, chosen from the site palette (D-082). All optional = defaults. */
  style: z
    .object({
      bg: z.enum(['auto', 'white', 'soft', 'brand', 'dark']).optional(),
      align: z.enum(['start', 'center']).optional(),
      spacing: z.enum(['compact', 'normal', 'airy']).optional(),
      titleColor: z.enum(['ink', 'brand', 'accent']).optional(),
      titleSize: z.enum(['normal', 'large']).optional(),
      button: z.enum(['solid', 'outline']).optional(),
    })
    .optional(),
};

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

export const SECTION_TYPES = [
  'hero',
  'about',
  'services',
  'gallery',
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
  gallery: 'גלריה',
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

/** Lead form inside the contact section (F07). Defaults keep drafts saved before F07 valid. */
export const DEFAULT_CONTACT_FORM = {
  enabled: true,
  askEmail: true,
  askMessage: true,
  buttonLabel: 'שליחה',
  successMessage: 'תודה! קיבלנו את הפרטים ונחזור אליכם בהקדם.',
  askAppointment: false,
};
export const contactFormSchema = z.object({
  enabled: z.boolean(),
  askEmail: z.boolean(),
  askMessage: z.boolean(),
  buttonLabel: z.string().trim().min(1, siteMessages.required).max(40, siteMessages.textTooLong),
  successMessage: short,
  /** F17: let visitors request an appointment (service, date, time), confirmed manually. */
  askAppointment: z.boolean().default(false),
});
export type ContactForm = z.infer<typeof contactFormSchema>;

/** Optional image reference (F05); defaults keep drafts saved before F05 valid. */
const imageRef = z.string().uuid().nullable().default(null);
const altText = z.string().trim().max(160, siteMessages.textTooLong).default('');

export const sectionSchema = z.discriminatedUnion('type', [
  z.object({
    ...base,
    type: z.literal('hero'),
    title,
    subtitle: short,
    buttonLabel: z.string().trim().max(40, siteMessages.textTooLong),
    buttonAction: z.enum(HERO_ACTIONS),
    /** The second button (the other way to get in touch); empty = automatic label (D-075). */
    secondaryLabel: z.string().trim().max(40, siteMessages.textTooLong).optional(),
    /** Background image (decorative). */
    imageAssetId: imageRef,
  }),
  z.object({
    ...base,
    type: z.literal('about'),
    title,
    body,
    imageAssetId: imageRef,
    imageAlt: altText,
  }),
  z.object({
    ...base,
    type: z.literal('gallery'),
    title,
    items: items(z.object({ assetId: z.string().uuid(), caption: altText })),
  }),
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
    form: contactFormSchema.default(DEFAULT_CONTACT_FORM),
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
export type SectionStyle = NonNullable<Section['style']>;

// ---------------------------------------------------------------------------
// Pages (D-081): the home page is the site's own sections; extra pages live in `pages`.
// ---------------------------------------------------------------------------

/** Addresses the public site server uses itself. */
export const RESERVED_PAGE_SLUGS = new Set(['media', 'sitemap', 'robots', 'index', 'api', 'q']);
export const pageSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, siteMessages.pageSlugInvalid)
  .max(40, siteMessages.pageSlugInvalid)
  .refine((v) => !RESERVED_PAGE_SLUGS.has(v), siteMessages.pageSlugReserved);

export const sitePageSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
  slug: pageSlugSchema,
  /** Name in the site menu. */
  title: z.string().trim().min(1, siteMessages.pageTitleRequired).max(30, siteMessages.textTooLong),
  inMenu: z.boolean(),
  seo: z.object({
    title: z.string().trim().max(70, 'כותרת לגוגל יכולה להכיל עד 70 תווים'),
    description: z.string().trim().max(160, 'תיאור לגוגל יכול להכיל עד 160 תווים'),
  }),
  sections: z.array(sectionSchema).max(SITE_LIMITS.sections, siteMessages.tooManySections),
});
export type SitePage = z.infer<typeof sitePageSchema>;

/** Unique page addresses, and section ids unique across the whole site (forms post by id). */
export function checkPages(
  draft: { sections: { id: string }[]; pages: { slug: string; sections: { id: string }[] }[] },
  ctx: z.RefinementCtx,
) {
  const slugs = new Set<string>();
  draft.pages.forEach((p, i) => {
    if (slugs.has(p.slug)) {
      ctx.addIssue({
        code: 'custom',
        path: ['pages', i, 'slug'],
        message: siteMessages.pageSlugTaken,
      });
    }
    slugs.add(p.slug);
  });
  const ids = [...draft.sections, ...draft.pages.flatMap((p) => p.sections)].map((s) => s.id);
  if (new Set(ids).size !== ids.length) {
    ctx.addIssue({ code: 'custom', path: ['sections'], message: 'מזהי מקטעים כפולים' });
  }
}

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

// ---- Custom colours (D-083) -------------------------------------------------

const HEX = /^#[0-9a-f]{6}$/i;
const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const luminance = (hex: string) => {
  const [r, g, b] = channels(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** WCAG contrast ratio of a colour against white (buttons carry white text). */
export const contrastWithWhite = (hex: string) => 1.05 / (luminance(hex) + 0.05);
/** Minimum for white button text on the main colour (WCAG AA, normal text). */
export const MIN_BRAND_CONTRAST = 4.5;
const toHex = (rgb: number[]) =>
  `#${rgb
    .map((v) =>
      Math.round(Math.min(255, Math.max(0, v)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
/** Mixes a colour with another (`t` = share of `other`, 0–1). */
export const mixHex = (hex: string, other: string, t: number) => {
  const a = channels(hex);
  const b = channels(other);
  return toHex(a.map((v, i) => v + (b[i]! - v) * t));
};
/** The same hue, darkened just enough for white text to be readable. */
export function darkenForContrast(hex: string, min = MIN_BRAND_CONTRAST): string {
  let out = hex.toLowerCase();
  for (let i = 0; i < 40 && contrastWithWhite(out) < min; i++) out = mixHex(out, '#000000', 0.06);
  return out;
}
export const customColorsSchema = z.object({
  primary: z
    .string()
    .regex(HEX, 'צבע לא תקין')
    .refine(
      (v) => contrastWithWhite(v) >= MIN_BRAND_CONTRAST,
      'הצבע הראשי בהיר מדי לטקסט לבן על כפתורים. בחרו גוון כהה יותר',
    ),
  accent: z.string().regex(HEX, 'צבע לא תקין'),
});
export type CustomColors = z.infer<typeof customColorsSchema>;

export const themeSchema = z.object({
  palette: z.enum(PALETTE_KEYS),
  /** Owner-chosen colours; when set they replace the palette's (D-083). */
  custom: customColorsSchema.nullable().optional(),
  font: z.enum(FONT_KEYS),
  /** Logo shown in the site header (F05). */
  logoAssetId: z.string().uuid().nullable().default(null),
  /** Wording of fixed site buttons; empty = default (D-075). */
  labels: z
    .object({
      mobileCall: z.string().trim().max(30, siteMessages.textTooLong).optional(),
      mobileContact: z.string().trim().max(30, siteMessages.textTooLong).optional(),
      cardLink: z.string().trim().max(60, siteMessages.textTooLong).optional(),
    })
    .optional(),
});
export type SiteTheme = z.infer<typeof themeSchema>;

/** The colours a site actually uses: its custom colours, or the chosen palette. */
export function resolvePalette(theme: Pick<SiteTheme, 'palette' | 'custom'>) {
  if (theme.custom) {
    return {
      primary: theme.custom.primary,
      accent: theme.custom.accent,
      soft: mixHex(theme.custom.primary, '#ffffff', 0.92),
    };
  }
  const p = PALETTES[theme.palette];
  return { primary: p.primary, accent: p.accent, soft: p.soft };
}

export const seoSchema = z.object({
  title: z.string().trim().max(70, 'כותרת לגוגל יכולה להכיל עד 70 תווים'),
  description: z.string().trim().max(160, 'תיאור לגוגל יכול להכיל עד 160 תווים'),
});
export type SiteSeo = z.infer<typeof seoSchema>;

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

/** Templates (D-031 / O-002, D-069). Other industries start from the closest one. */
export const TEMPLATE_KEYS = ['beauty', 'trades', 'garage', 'clinic', 'food'] as const;
export const templateKeySchema = z.enum(TEMPLATE_KEYS);
export type TemplateKey = z.infer<typeof templateKeySchema>;

export const templateInfo: Record<TemplateKey, { label: string; description: string }> = {
  beauty: {
    label: 'יופי וטיפוח',
    description: 'למספרות, קוסמטיקה וסטודיו: שירותים, מחירון, המלצות וקביעת תור.',
  },
  trades: {
    label: 'בעלי מקצוע ושירות',
    description: 'לחשמלאים, אינסטלטורים ושיפוצים: שירותים, אזורי שירות ו"התקשרו עכשיו".',
  },
  garage: {
    label: 'מוסכים ורכב',
    description: 'למוסכים, פחחות וחשמלאי רכב: שירותים, הכנה לטסט, שעות פתיחה וקביעת טיפול.',
  },
  clinic: {
    label: 'קליניקה ומטפלים',
    description:
      'לפיזיותרפיה, טיפול רגשי, דיאטנים ורפואה משלימה: תהליך טיפול, שאלות נפוצות ופגישה.',
  },
  food: {
    label: 'מסעדה ובית קפה',
    description: 'למסעדות, בתי קפה וקייטרינג: מהתפריט, שעות פתיחה, הזמנת שולחן ואירועים.',
  },
};

/** Suggested template for an industry (owners can pick either). */
export function templateForIndustry(industry: string): TemplateKey {
  if (industry === 'beauty' || industry === 'studio') return 'beauty';
  if (industry === 'garage') return 'garage';
  return 'trades';
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export const SITE_STATUSES = ['DRAFT', 'PUBLISHED', 'SUSPENDED'] as const;

export const publishedVersionSchema = z.object({
  versionId: z.string().uuid(),
  number: z.number().int(),
  /** Draft revision that was published; differs from `revision` when there are unpublished edits. */
  revision: z.number().int(),
  publishedAt: z.string().datetime(),
});

export const siteSchema = z.object({
  id: z.string().uuid(),
  subdomain: z.string().nullable(),
  /** Live address once a subdomain is chosen (e.g. http://shiran.lvh.me:4100). */
  publicUrl: z.string().nullable(),
  /** Host suffix shown next to the subdomain field, e.g. "lvh.me:4100". */
  publicDomain: z.string(),
  published: publishedVersionSchema.nullable(),
  templateKey: templateKeySchema,
  theme: themeSchema,
  seo: seoSchema,
  sections: z.array(sectionSchema),
  pages: z.array(sitePageSchema),
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
export const saveDraftRequestSchema = z
  .object({
    revision: z.number().int().min(0),
    templateKey: templateKeySchema,
    theme: themeSchema,
    seo: seoSchema,
    sections: z
      .array(sectionSchema)
      .max(SITE_LIMITS.sections, siteMessages.tooManySections)
      .refine((s) => new Set(s.map((x) => x.id)).size === s.length, 'מזהי מקטעים כפולים'),
    pages: z.array(sitePageSchema).max(SITE_LIMITS.pages, siteMessages.tooManyPages).default([]),
  })
  .superRefine((d, ctx) => checkPages(d, ctx));
export type SaveDraftRequest = z.infer<typeof saveDraftRequestSchema>;

export const setSubdomainRequestSchema = z.object({ subdomain: subdomainSchema });
export type SetSubdomainRequest = z.infer<typeof setSubdomainRequestSchema>;

/** Publishes exactly the draft revision the owner is looking at (409 if it moved on). */
export const publishRequestSchema = z.object({ revision: z.number().int().min(0) });
export type PublishRequest = z.infer<typeof publishRequestSchema>;

export const siteVersionSchema = z.object({
  id: z.string().uuid(),
  number: z.number().int(),
  publishedAt: z.string().datetime(),
  publishedBy: z.string().nullable(),
  live: z.boolean(),
});
export type SiteVersion = z.infer<typeof siteVersionSchema>;
export const siteVersionListResponseSchema = z.object({ versions: z.array(siteVersionSchema) });
export type SiteVersionListResponse = z.infer<typeof siteVersionListResponseSchema>;

export const siteAuditActions = [
  'site.created',
  'site.subdomain.changed',
  'site.published',
  'site.rolled_back',
  'site.unpublished',
] as const;

export const siteApiPaths = {
  site: (businessId: string) => `/api/v1/businesses/${businessId}/site`,
  draft: (businessId: string) => `/api/v1/businesses/${businessId}/site/draft`,
  subdomain: (businessId: string) => `/api/v1/businesses/${businessId}/site/subdomain`,
  publish: (businessId: string) => `/api/v1/businesses/${businessId}/site/publish`,
  unpublish: (businessId: string) => `/api/v1/businesses/${businessId}/site/unpublish`,
  versions: (businessId: string) => `/api/v1/businesses/${businessId}/site/versions`,
  rollback: (businessId: string, versionId: string) =>
    `/api/v1/businesses/${businessId}/site/versions/${versionId}/rollback`,
} as const;
