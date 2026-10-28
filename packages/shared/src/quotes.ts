import { z } from 'zod';

/**
 * F18 — Quotes (PRD §8, §19.6): created from a lead, with line items, quantity, price, discount,
 * VAT and notes; draft → sent (private link / email) → accepted or rejected; validity date.
 * Money is in agorot (integers) everywhere; totals are computed by `quoteTotals`.
 */

export const QUOTE_STATUSES = ['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED'] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];
/** Display status: a sent quote past its validity date shows as expired. */
export type QuoteDisplayStatus = QuoteStatus | 'EXPIRED';
export const quoteStatusLabels: Record<QuoteDisplayStatus, string> = {
  DRAFT: 'טיוטה',
  SENT: 'נשלחה',
  ACCEPTED: 'אושרה',
  REJECTED: 'נדחתה',
  EXPIRED: 'פג תוקף',
};

/** Israeli VAT (18% since 1/2025). 0 = no VAT (e.g. an exempt dealer, עוסק פטור). */
export const DEFAULT_VAT_RATE = 18;

export const quoteMessages = {
  titleTooLong: 'הכותרת ארוכה מדי (עד 120 תווים)',
  itemRequired: 'יש להוסיף לפחות שורה אחת',
  tooManyItems: 'אפשר עד 50 שורות',
  descriptionRequired: 'יש לתאר את השירות או המוצר',
  descriptionTooLong: 'התיאור ארוך מדי (עד 300 תווים)',
  quantityInvalid: 'כמות בין 1 ל־9,999',
  priceInvalid: 'מחיר לא תקין',
  discountInvalid: 'ההנחה לא יכולה להיות גבוהה מהסכום',
  vatInvalid: 'שיעור מע״מ לא תקין',
  notesTooLong: 'ההערות ארוכות מדי (עד 2,000 תווים)',
  leadInvalid: 'הליד שנבחר אינו קיים',
  notDraft: 'אפשר לערוך רק טיוטה. כדי לשנות הצעה שנשלחה, שכפלו אותה.',
  notOpen: 'ההצעה כבר אינה ממתינה להחלטה',
  expired: 'תוקף ההצעה פג. אפשר לפנות לעסק לקבלת הצעה מעודכנת.',
  noEmail: 'ללקוח אין כתובת אימייל. אפשר לשלוח את הקישור ב־WhatsApp או להעתיק אותו.',
} as const;

const agorot = z
  .number({ invalid_type_error: quoteMessages.priceInvalid })
  .int(quoteMessages.priceInvalid)
  .min(0, quoteMessages.priceInvalid)
  .max(10_000_000_00, quoteMessages.priceInvalid);

export const quoteItemSchema = z.object({
  description: z
    .string({ required_error: quoteMessages.descriptionRequired })
    .trim()
    .min(1, quoteMessages.descriptionRequired)
    .max(300, quoteMessages.descriptionTooLong),
  quantity: z
    .number({ invalid_type_error: quoteMessages.quantityInvalid })
    .int(quoteMessages.quantityInvalid)
    .min(1, quoteMessages.quantityInvalid)
    .max(9999, quoteMessages.quantityInvalid),
  /** Agorot, before VAT. */
  unitPrice: agorot,
});
export type QuoteItem = z.infer<typeof quoteItemSchema>;

export interface QuoteTotals {
  subtotal: number;
  discount: number;
  vat: number;
  total: number;
}
/** All amounts in agorot. VAT is on the amount after discount, rounded to the agora. */
export function quoteTotals(
  items: Pick<QuoteItem, 'quantity' | 'unitPrice'>[],
  discount: number,
  vatRate: number,
): QuoteTotals {
  const subtotal = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
  const d = Math.min(Math.max(discount, 0), subtotal);
  const vat = Math.round(((subtotal - d) * vatRate) / 100);
  return { subtotal, discount: d, vat, total: subtotal - d + vat };
}

/** ₪1,234.50 from agorot. */
export const formatAgorot = (a: number) =>
  new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS' }).format(a / 100);

export const upsertQuoteRequestSchema = z
  .object({
    title: z.string().trim().max(120, quoteMessages.titleTooLong).default(''),
    items: z
      .array(quoteItemSchema)
      .min(1, quoteMessages.itemRequired)
      .max(50, quoteMessages.tooManyItems),
    discount: agorot.default(0),
    vatRate: z
      .number({ invalid_type_error: quoteMessages.vatInvalid })
      .min(0, quoteMessages.vatInvalid)
      .max(30, quoteMessages.vatInvalid)
      .default(DEFAULT_VAT_RATE),
    notes: z.string().trim().max(2000, quoteMessages.notesTooLong).default(''),
    /** `YYYY-MM-DD`; null = no expiry. */
    validUntil: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .default(null),
  })
  .refine((q) => q.discount <= quoteTotals(q.items, 0, 0).subtotal, {
    message: quoteMessages.discountInvalid,
    path: ['discount'],
  });
export type UpsertQuoteRequest = z.input<typeof upsertQuoteRequestSchema>;

export const createQuoteRequestSchema = upsertQuoteRequestSchema.and(
  z.object({ leadId: z.string().uuid() }),
);
export type CreateQuoteRequest = z.input<typeof createQuoteRequestSchema>;

export const quoteSchema = z.object({
  id: z.string().uuid(),
  number: z.number().int(),
  title: z.string(),
  items: z.array(quoteItemSchema),
  discount: z.number().int(),
  vatRate: z.number(),
  notes: z.string(),
  validUntil: z.string().nullable(),
  status: z.enum(QUOTE_STATUSES),
  expired: z.boolean(),
  totals: z.object({
    subtotal: z.number().int(),
    discount: z.number().int(),
    vat: z.number().int(),
    total: z.number().int(),
  }),
  lead: z.object({ id: z.string().uuid() }),
  customer: z.object({
    name: z.string(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
  }),
  /** Customer page link, once the quote has been sent. */
  publicUrl: z.string().nullable(),
  sentAt: z.string().datetime().nullable(),
  decidedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Quote = z.infer<typeof quoteSchema>;

export const quoteResponseSchema = z.object({ quote: quoteSchema });
export type QuoteResponse = z.infer<typeof quoteResponseSchema>;
export const quoteListResponseSchema = z.object({ quotes: z.array(quoteSchema) });
export type QuoteListResponse = z.infer<typeof quoteListResponseSchema>;

export const quoteListQuerySchema = z.object({
  status: z.enum(QUOTE_STATUSES).optional(),
  leadId: z.string().uuid().optional(),
});
export type QuoteListQuery = z.input<typeof quoteListQuerySchema>;

export const sendQuoteRequestSchema = z.object({ email: z.boolean().default(false) });
export const decideQuoteRequestSchema = z.object({ status: z.enum(['ACCEPTED', 'REJECTED']) });

/** What the customer sees on the quote page (no internal ids). */
export const publicQuoteSchema = z.object({
  number: z.number().int(),
  title: z.string(),
  items: z.array(quoteItemSchema),
  vatRate: z.number(),
  notes: z.string(),
  validUntil: z.string().nullable(),
  status: z.enum(QUOTE_STATUSES),
  expired: z.boolean(),
  totals: quoteSchema.shape.totals,
  sentAt: z.string().datetime().nullable(),
  customerName: z.string(),
  business: z.object({
    name: z.string(),
    phone: z.string().nullable(),
    address: z.string().nullable(),
  }),
});
export type PublicQuote = z.infer<typeof publicQuoteSchema>;
export const publicQuoteResponseSchema = z.object({ quote: publicQuoteSchema });
export type PublicQuoteResponse = z.infer<typeof publicQuoteResponseSchema>;
export const publicDecisionRequestSchema = z.object({ decision: z.enum(['accept', 'reject']) });

/** Unguessable link token (32 random bytes, base64url). */
export const QUOTE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const QUOTE_WEB_PATH = '/q';

export const quotesApiPaths = {
  list: (businessId: string) => `/api/v1/businesses/${businessId}/quotes`,
  quote: (businessId: string, id: string) => `/api/v1/businesses/${businessId}/quotes/${id}`,
  send: (businessId: string, id: string) => `/api/v1/businesses/${businessId}/quotes/${id}/send`,
  duplicate: (businessId: string, id: string) =>
    `/api/v1/businesses/${businessId}/quotes/${id}/duplicate`,
  decide: (businessId: string, id: string) =>
    `/api/v1/businesses/${businessId}/quotes/${id}/status`,
  publicQuote: (token: string) => `/api/v1/public/quotes/${token}`,
  publicDecision: (token: string) => `/api/v1/public/quotes/${token}/decision`,
} as const;
