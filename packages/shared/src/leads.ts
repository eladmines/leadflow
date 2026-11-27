import { z } from 'zod';
import { phoneSchema } from './business';
import { ATTRIBUTION_SOURCES, attributionSchema } from './attribution';
import { customFieldsInputSchema, customFieldValuesSchema } from './leadFields';

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
  slotIncomplete: 'לבקשת תור יש לבחור גם תאריך וגם שעה',
  slotInvalid: 'המועד שנבחר לתור אינו תקין',
  slotPast: 'אפשר לבקש תור רק למועד עתידי (עד 4 חודשים קדימה)',
} as const;

const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .optional()
    .transform((v) => (v ? v : null));

/** Public form fields (urlencoded strings). Unknown fields are ignored. */
export const leadSubmissionSchema = z
  .object({
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
    // F17 appointment request (optional): service, local date and time in the business time zone.
    serviceId: z
      .string()
      .optional()
      .transform((v) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : null)),
    date: z
      .string()
      .optional()
      .transform((v) => v || null)
      .refine((v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v), leadMessages.slotInvalid),
    time: z
      .string()
      .optional()
      .transform((v) => v || null)
      .refine((v) => v === null || /^([01]\d|2[0-3]):[0-5]\d$/.test(v), leadMessages.slotInvalid),
  })
  .refine((v) => (v.date === null) === (v.time === null), {
    message: leadMessages.slotIncomplete,
    path: ['date'],
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

export const LEAD_SOURCES = [
  'website_form',
  'manual',
  'whatsapp',
  'facebook',
  'instagram',
  'email',
] as const;
export const leadSourceLabels: Record<(typeof LEAD_SOURCES)[number], string> = {
  website_form: 'טופס באתר',
  manual: 'הוזן ידנית',
  whatsapp: 'WhatsApp',
  facebook: 'פייסבוק',
  instagram: 'אינסטגרם',
  email: 'מייל',
};

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/**
 * D-207/D-208/D-210 — a lead's money comes only from its quotes. Both amounts are whole shekels
 * from quote `totals.total` (agorot: after discount, incl. VAT), rounded half-up once per lead
 * (`agorotToShekels`). A lead with no qualifying quote has 0.
 * - `won`: the sum of **all** its quotes with status `ACCEPTED` (also each purchase on Customers).
 * - `open` (D-210): only the lead's **latest sent quote** — the one with the latest `sentAt`
 *   among its quotes that were ever sent (ties: higher quote number) — and only while that quote is
 *   still `SENT` and not expired (`validUntil` null or not before today in the business's time
 *   zone, the same rule as the quote's `expired` flag). If the latest sent quote was accepted,
 *   rejected or has expired, `open` is 0 even when an older sent quote is still open, so a revised
 *   quote is never counted twice. Drafts never count.
 * The value doesn't depend on the stage; aggregates pick by stage kind (board and reports: `open`
 * for OPEN stages, `won` for WON stages, nothing for LOST; D-208, D-210 §3).
 * D-209: the lead page's quotes card is where this value comes from.
 */
export const leadValueSchema = z.object({
  won: z.number().int().min(0),
  open: z.number().int().min(0),
});
export type LeadValue = z.infer<typeof leadValueSchema>;

/** Agorot → whole shekels, half-up (non-negative amounts only). */
export const agorotToShekels = (agorot: number): number => Math.floor((agorot + 50) / 100);

/** What a board column / stage row sums for a lead in a stage of this kind (D-208). */
export function leadValueForStageKind(
  value: LeadValue,
  kind: (typeof STAGE_KINDS)[number],
): number {
  return kind === 'WON' ? value.won : kind === 'OPEN' ? value.open : 0;
}

/**
 * D-209 — a lead's next action is its nearest open task: among tasks linked to the lead with status
 * `OPEN`, the one with the earliest `dueAt` (overdue ones included, so the most overdue comes
 * first; ties by creation time, then id). Only tasks the member may see count (`tasks.view.all`, or
 * the member's own tasks for employees), so an employee never learns of a teammate's task.
 * The same shape as `Task` (F10) narrowed to what the lead needs; overdue = `dueAt` < now.
 */
export const leadNextTaskSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  dueAt: z.string().datetime(),
  assignee: z.object({ id: z.string().uuid(), name: z.string() }),
});
export type LeadNextTask = z.infer<typeof leadNextTaskSchema>;

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
  /** F26: the source, ad and campaign behind the lead; null/absent for older leads ("Unknown"). */
  attribution: attributionSchema.nullable().optional(),
  message: z.string().nullable(),
  /** Assigned team member (F08). */
  owner: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
  /**
   * D-207: the lead's value, derived from its quotes (read-only; there is no typed estimate).
   * Whole shekels (incl. VAT, after discount), see `leadValueSchema`.
   */
  value: leadValueSchema,
  /**
   * D-209: the lead's next action = its nearest open task (read-only; replaces `nextActionAt`).
   * See `leadNextTaskSchema`; null when there is no open task the member may see.
   */
  nextTask: leadNextTaskSchema.nullable(),
  /** Free labels chosen by the business, e.g. "VIP", "חוזר" (lowercased duplicates removed). */
  tags: z.array(z.string()),
  /**
   * F34 custom fields: `{ [definitionId]: value }`, archived fields' values included. The API
   * always sends it (`{}` when none); optional only so older payloads still parse.
   */
  customFields: customFieldValuesSchema.optional(),
  /** Latest WhatsApp message with this contact (F12), for list previews; absent = none. */
  lastWhatsApp: z
    .object({
      body: z.string(),
      direction: z.enum(['IN', 'OUT']),
      createdAt: z.string().datetime(),
    })
    .nullable()
    .optional(),
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
  noteRequired: 'יש לכתוב הערה',
  noteTooLong: 'ההערה ארוכה מדי (עד 2,000 תווים)',
  stageInvalid: 'השלב שנבחר אינו קיים',
  ownerInvalid: 'אפשר לשייך רק לחבר צוות פעיל בעסק',
  tagTooLong: 'תגית יכולה להכיל עד 30 תווים',
  tooManyTags: 'אפשר עד 10 תגיות לליד',
} as const;

export const MAX_LEAD_TAGS = 10;
const tagSchema = z.string().trim().min(1).max(30, crmMessages.tagTooLong);
/** Tags without duplicates (case-insensitive), in the order given. */
export const leadTagsSchema = z
  .array(tagSchema)
  .max(MAX_LEAD_TAGS, crmMessages.tooManyTags)
  .transform((tags) =>
    tags.filter((t, i) => tags.findIndex((o) => o.toLowerCase() === t.toLowerCase()) === i),
  );

const uuid = z.string().uuid();
const optionalUuidParam = z
  .string()
  .optional()
  .transform((v) => (v ? v : undefined))
  .pipe(uuid.optional());

/**
 * GET /leads query: free-text search + filters. `ownerId=none` = unassigned.
 * F34 custom-field filters travel as `cf[<fieldId>]=…` / `cf[<fieldId>][from|to]=…` next to these
 * (see `leadFieldFilterParams` / `parseLeadFieldFilterParams` in `leadFields.ts`).
 */
export const leadListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  stageId: optionalUuidParam,
  ownerId: z.union([z.literal('none'), uuid]).optional(),
  source: z.enum(LEAD_SOURCES).optional(),
  /** F26: where it came from; `unknown` = no attribution recorded. */
  from: z.enum([...ATTRIBUTION_SOURCES, 'unknown']).optional(),
  campaign: z.string().trim().max(100).optional(),
  tag: z.string().trim().max(30).optional(),
});
export type LeadListQuery = z.input<typeof leadListQuerySchema>;

/**
 * Manual lead (F08). Needs a name and a phone or an email; a matching contact is reused.
 * D-207: no value field; an `expectedValue` key sent by an old client is stripped, not stored.
 */
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
    /**
     * F34: shape only; checked per business with `validateCustomFields`, options from
     * `createLeadCustomFieldsOptions(body)`.
     */
    customFields: customFieldsInputSchema.optional().default({}),
    /**
     * F34, D-205: `true` from quick "add customer" paths in the app (e.g. the quote screen's dialog):
     * required custom fields are not demanded, but every value sent is still validated. Absent or
     * `false` (the full New lead dialog) = required fields are enforced.
     */
    skipRequiredCustomFields: z.boolean().optional().default(false),
  })
  .refine((v) => v.phone || v.email, { message: crmMessages.contactRequired, path: ['phone'] });
export type CreateLeadRequest = z.input<typeof createLeadRequestSchema>;

/**
 * PATCH /leads/:id — every field optional; each change is recorded in the activity log. Fields
 * sent together are validated first and saved in one transaction (the lead page's one "שמירה"
 * sends `customFields`, D-207/D-209). No `expectedValue` (D-207) and no `nextActionAt` (D-209: the
 * next action is a task); old keys are stripped, not stored.
 */
export const updateLeadRequestSchema = z.object({
  stageId: uuid.optional(),
  ownerId: uuid.nullable().optional(),
  message: optionalText(1000, leadMessages.messageTooLong).optional(),
  tags: leadTagsSchema.optional(),
  /**
   * F34: a patch of custom values (keys sent change; `null`/`""` removes a value; absent keys stay).
   * Shape only; checked per business with `validateCustomFields` (mode 'update').
   */
  customFields: customFieldsInputSchema.optional(),
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
  'task.created',
  'task.completed',
  'appointment.created',
  'appointment.updated',
  'quote.created',
  'quote.sent',
  'quote.accepted',
  'quote.rejected',
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

/** Tags in use on the leads the member can see, most used first (for suggestions and filters). */
export const leadTagsResponseSchema = z.object({ tags: z.array(z.string()) });
export type LeadTagsResponse = z.infer<typeof leadTagsResponseSchema>;

// ---------------------------------------------------------------------------
// Import customers from a spreadsheet (D-179)
// ---------------------------------------------------------------------------

/** Rows per import. The file is read in the browser; only these fields are sent. */
export const IMPORT_MAX_ROWS = 1000;

export const importMessages = {
  tooMany: `אפשר לייבא עד ${IMPORT_MAX_ROWS} שורות בכל פעם`,
  noRows: 'לא נמצאו שורות לייבוא',
  nameInvalid: 'שם חסר או קצר מדי',
  contactMissing: 'חסר טלפון או אימייל',
  phoneInvalid: 'מספר הטלפון אינו תקין',
  emailInvalid: 'כתובת האימייל אינה תקינה',
  alreadyCustomer: 'כבר קיים כלקוח',
} as const;

/**
 * A spreadsheet row as the browser sends it: raw text, checked per row on the server.
 * D-207: no value/amount column (a lead's value comes only from quotes); a `value` key is stripped.
 */
export const importCustomerRowSchema = z.object({
  name: z.string().max(200).optional(),
  phone: z.string().max(60).optional(),
  email: z.string().max(300).optional(),
});
export type ImportCustomerRow = z.infer<typeof importCustomerRowSchema>;

export const importCustomersRequestSchema = z.object({
  rows: z
    .array(importCustomerRowSchema)
    .min(1, importMessages.noRows)
    .max(IMPORT_MAX_ROWS, importMessages.tooMany),
});
export type ImportCustomersRequest = z.infer<typeof importCustomersRequestSchema>;

export const importCustomersResponseSchema = z.object({
  /** New customers: a contact (new or existing) with a lead in a Won stage. */
  imported: z.number().int(),
  /** Rows skipped because the person is already a customer (or appeared twice in the file). */
  duplicates: z.number().int(),
  /** Rows that couldn't be imported, by 1-based row number in the data (header excluded). */
  invalid: z.array(z.object({ row: z.number().int(), reason: z.string() })),
});
export type ImportCustomersResponse = z.infer<typeof importCustomersResponseSchema>;

export const leadsApiPaths = {
  list: (businessId: string) => `/api/v1/businesses/${businessId}/leads`,
  detail: (businessId: string, leadId: string) =>
    `/api/v1/businesses/${businessId}/leads/${leadId}`,
  notes: (businessId: string, leadId: string) =>
    `/api/v1/businesses/${businessId}/leads/${leadId}/notes`,
  pipeline: (businessId: string) => `/api/v1/businesses/${businessId}/pipeline`,
  duplicates: (businessId: string) => `/api/v1/businesses/${businessId}/contacts/duplicates`,
  /** CSV download (same filters as the list). Plain GET so a link can trigger it. */
  exportCsv: (businessId: string) => `/api/v1/businesses/${businessId}/leads/export.csv`,
  tags: (businessId: string) => `/api/v1/businesses/${businessId}/leads/tags`,
  importCustomers: (businessId: string) => `/api/v1/businesses/${businessId}/customers/import`,
} as const;
