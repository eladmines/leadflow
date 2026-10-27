import { z } from 'zod';
import { phoneSchema } from './business';

/**
 * F07 — Lead capture. Visitors submit the contact-section form on a published site (a plain HTML
 * form; customer sites run no JavaScript). Each accepted submission creates or reuses a Contact
 * (matched by phone within the business) and a new Lead in the first pipeline stage.
 */

/** Path the public-site form posts to (same origin as the site, allowed by `form-action 'self'`). */
export const LEAD_FORM_PATH = '/__lead';
/** Replaced by the public server with a fresh signed token on every page view. */
export const FORM_TOKEN_PLACEHOLDER = '__LF_FORM_TOKEN__';
/** Submissions faster than this after the page was served are treated as bots. */
export const FORM_MIN_FILL_MS = 3000;
/** Tokens older than this are rejected (the page was open too long; refresh and resend). */
export const FORM_TOKEN_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** Field visitors never see (hidden with CSS); bots tend to fill it. */
export const HONEYPOT_FIELD = 'website';

export const leadMessages = {
  nameRequired: 'יש להזין שם',
  nameTooLong: 'השם ארוך מדי',
  emailInvalid: 'כתובת האימייל אינה תקינה',
  messageTooLong: 'ההודעה ארוכה מדי (עד 1,000 תווים)',
  consentRequired: 'יש לאשר את יצירת הקשר כדי לשלוח',
  formExpired: 'תוקף הטופס פג. רעננו את הדף ונסו שוב.',
} as const;

const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .optional()
    .transform((v) => (v ? v : null));

/** Public form fields (urlencoded strings). Unknown fields are ignored. */
export const leadSubmissionSchema = z.object({
  name: z
    .string({ required_error: leadMessages.nameRequired })
    .trim()
    .min(2, leadMessages.nameRequired)
    .max(80, leadMessages.nameTooLong),
  phone: phoneSchema,
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254, leadMessages.emailInvalid)
    .optional()
    .transform((v) => (v ? v : null))
    .refine(
      (v) => v === null || z.string().email().safeParse(v).success,
      leadMessages.emailInvalid,
    ),
  message: optionalText(1000, leadMessages.messageTooLong),
  consent: z.literal('on', { errorMap: () => ({ message: leadMessages.consentRequired }) }),
});
export type LeadSubmission = z.output<typeof leadSubmissionSchema>;

// ---------------------------------------------------------------------------
// Pipeline (PRD §4: חדש, נוצר קשר, הצעה נשלחה, ממתין, נסגר/אבוד)
// ---------------------------------------------------------------------------

export const STAGE_KINDS = ['OPEN', 'WON', 'LOST'] as const;
export const DEFAULT_PIPELINE_STAGES: { name: string; kind: (typeof STAGE_KINDS)[number] }[] = [
  { name: 'חדש', kind: 'OPEN' },
  { name: 'נוצר קשר', kind: 'OPEN' },
  { name: 'הצעה נשלחה', kind: 'OPEN' },
  { name: 'ממתין', kind: 'OPEN' },
  { name: 'נסגר', kind: 'WON' },
  { name: 'אבוד', kind: 'LOST' },
];

export const LEAD_SOURCES = ['website_form', 'manual', 'whatsapp'] as const;
export const leadSourceLabels: Record<(typeof LEAD_SOURCES)[number], string> = {
  website_form: 'טופס באתר',
  manual: 'הוזן ידנית',
  whatsapp: 'WhatsApp',
};

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export const leadSchema = z.object({
  id: z.string().uuid(),
  contact: z.object({
    id: z.string().uuid(),
    name: z.string(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
  }),
  stage: z.object({ id: z.string().uuid(), name: z.string(), kind: z.enum(STAGE_KINDS) }),
  source: z.enum(LEAD_SOURCES),
  sourceUrl: z.string().nullable(),
  message: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type Lead = z.infer<typeof leadSchema>;

export const leadListResponseSchema = z.object({ leads: z.array(leadSchema) });
export type LeadListResponse = z.infer<typeof leadListResponseSchema>;

export const leadsApiPaths = {
  list: (businessId: string) => `/api/v1/businesses/${businessId}/leads`,
} as const;

export const leadAuditActions = ['lead.created'] as const;
