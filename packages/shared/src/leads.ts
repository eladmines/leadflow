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
  /** Assigned team member (F08). */
  owner: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
  /** Expected deal value in whole shekels. */
  expectedValue: z.number().int().nullable(),
  nextActionAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Lead = z.infer<typeof leadSchema>;

export const leadListResponseSchema = z.object({ leads: z.array(leadSchema) });
export type LeadListResponse = z.infer<typeof leadListResponseSchema>;

// ---------------------------------------------------------------------------
// F08 — CRM
// ---------------------------------------------------------------------------

export const crmMessages = {
  contactRequired: 'יש להזין טלפון או אימייל',
  valueInvalid: 'יש להזין סכום בשקלים (מספר שלם)',
  noteRequired: 'יש לכתוב הערה',
  noteTooLong: 'ההערה ארוכה מדי (עד 2,000 תווים)',
  stageInvalid: 'השלב שנבחר אינו קיים',
  ownerInvalid: 'אפשר לשייך רק לחבר צוות פעיל בעסק',
} as const;

const uuid = z.string().uuid();
const optionalUuidParam = z
  .string()
  .optional()
  .transform((v) => (v ? v : undefined))
  .pipe(uuid.optional());

/** GET /leads query: free-text search + filters. `ownerId=none` = unassigned. */
export const leadListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  stageId: optionalUuidParam,
  ownerId: z.union([z.literal('none'), uuid]).optional(),
  source: z.enum(LEAD_SOURCES).optional(),
});
export type LeadListQuery = z.input<typeof leadListQuerySchema>;

const shekels = z
  .number({ invalid_type_error: crmMessages.valueInvalid })
  .int(crmMessages.valueInvalid)
  .min(0, crmMessages.valueInvalid)
  .max(100_000_000, crmMessages.valueInvalid);

/** Manual lead (F08). Needs a name and a phone or an email; a matching contact is reused. */
export const createLeadRequestSchema = z
  .object({
    name: z
      .string({ required_error: leadMessages.nameRequired })
      .trim()
      .min(2, leadMessages.nameRequired)
      .max(80, leadMessages.nameTooLong),
    phone: phoneSchema.optional().or(z.literal('').transform(() => undefined)),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .email(leadMessages.emailInvalid)
      .max(254)
      .optional()
      .or(z.literal('').transform(() => undefined)),
    message: optionalText(1000, leadMessages.messageTooLong),
    stageId: uuid.optional(),
    ownerId: uuid.nullable().optional(),
    expectedValue: shekels.nullable().optional(),
  })
  .refine((v) => v.phone || v.email, { message: crmMessages.contactRequired, path: ['phone'] });
export type CreateLeadRequest = z.input<typeof createLeadRequestSchema>;

/** PATCH /leads/:id — every field optional; each change is recorded in the activity log. */
export const updateLeadRequestSchema = z.object({
  stageId: uuid.optional(),
  ownerId: uuid.nullable().optional(),
  expectedValue: shekels.nullable().optional(),
  nextActionAt: z.string().datetime().nullable().optional(),
  message: optionalText(1000, leadMessages.messageTooLong).optional(),
});
export type UpdateLeadRequest = z.input<typeof updateLeadRequestSchema>;

export const addNoteRequestSchema = z.object({
  text: z
    .string({ required_error: crmMessages.noteRequired })
    .trim()
    .min(1, crmMessages.noteRequired)
    .max(2000, crmMessages.noteTooLong),
});
export type AddNoteRequest = z.infer<typeof addNoteRequestSchema>;

export const ACTIVITY_TYPES = [
  'lead.created',
  'lead.stage_changed',
  'lead.assigned',
  'lead.updated',
  'lead.note',
] as const;

export const activitySchema = z.object({
  id: z.string().uuid(),
  type: z.enum(ACTIVITY_TYPES),
  /** Type-specific details: stage names, assignee name, changed fields, note text. */
  data: z.record(z.unknown()),
  actor: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
  createdAt: z.string().datetime(),
});
export type Activity = z.infer<typeof activitySchema>;

export const leadDetailResponseSchema = z.object({
  lead: leadSchema,
  activities: z.array(activitySchema),
});
export type LeadDetailResponse = z.infer<typeof leadDetailResponseSchema>;
export const leadResponseSchema = z.object({ lead: leadSchema });
export type LeadResponse = z.infer<typeof leadResponseSchema>;

export const pipelineStageSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  position: z.number().int(),
  kind: z.enum(STAGE_KINDS),
});
export type PipelineStage = z.infer<typeof pipelineStageSchema>;
export const pipelineResponseSchema = z.object({ stages: z.array(pipelineStageSchema) });
export type PipelineResponse = z.infer<typeof pipelineResponseSchema>;

export const duplicateQuerySchema = z.object({
  phone: z.string().trim().max(30).optional(),
  email: z.string().trim().max(254).optional(),
});
export const duplicateContactSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  leadCount: z.number().int(),
});
export type DuplicateContact = z.infer<typeof duplicateContactSchema>;
export const duplicatesResponseSchema = z.object({ contacts: z.array(duplicateContactSchema) });
export type DuplicatesResponse = z.infer<typeof duplicatesResponseSchema>;

export const leadsApiPaths = {
  list: (businessId: string) => `/api/v1/businesses/${businessId}/leads`,
  detail: (businessId: string, leadId: string) =>
    `/api/v1/businesses/${businessId}/leads/${leadId}`,
  notes: (businessId: string, leadId: string) =>
    `/api/v1/businesses/${businessId}/leads/${leadId}/notes`,
  pipeline: (businessId: string) => `/api/v1/businesses/${businessId}/pipeline`,
  duplicates: (businessId: string) => `/api/v1/businesses/${businessId}/contacts/duplicates`,
} as const;

export const leadAuditActions = ['lead.created', 'lead.assigned'] as const;
