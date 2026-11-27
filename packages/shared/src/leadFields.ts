import { z } from 'zod';

/**
 * F34 — Custom lead fields (D-203, `docs/features/F34.md`). Each business defines its own lead
 * fields; a lead stores their values in `customFields`, keyed by the definition's id (never its
 * label), so renaming a field or an option keeps existing values.
 *
 * The API (Python) mirrors these rules in `apps/api-py/app/shared/lead_fields.py`; keep the limits
 * and the Hebrew messages identical on both sides.
 */

export const LEAD_FIELD_TYPES = ['text', 'number', 'date', 'select', 'boolean'] as const;
export type LeadFieldType = (typeof LEAD_FIELD_TYPES)[number];

/** Active (not archived) fields per business. */
export const MAX_ACTIVE_LEAD_FIELDS = 20;
export const LEAD_FIELD_LABEL_MAX = 40;
export const LEAD_FIELD_OPTIONS_MIN = 2;
export const LEAD_FIELD_OPTIONS_MAX = 30;
/** Options a select field keeps in total, archived ones included (D-204, proposed). */
export const LEAD_FIELD_OPTIONS_TOTAL_MAX = 100;
export const LEAD_FIELD_OPTION_LABEL_MAX = 60;
export const LEAD_FIELD_OPTION_ID_MAX = 40;
/** A text value: one line, up to this many characters. */
export const LEAD_FIELD_TEXT_MAX = 500;
/** Numbers are bounded so they stay exact in JSON and Postgres (D-204, proposed). */
export const LEAD_FIELD_NUMBER_ABS_MAX = 1_000_000_000_000;
/** Keys a lead's `customFields` may hold in one request (active + unchanged archived values). */
export const MAX_CUSTOM_FIELD_KEYS = 100;
/** Custom-field filters in one list request, and the length of a filter value. */
export const MAX_LEAD_FIELD_FILTERS = MAX_ACTIVE_LEAD_FIELDS;
export const LEAD_FIELD_FILTER_VALUE_MAX = 100;

const fmt = (n: number) => String(n);

/**
 * NUL, or a UTF-16 surrogate that isn't part of a pair: Postgres text and JSONB can't store them.
 * (Python port: `\x00|[\ud800-\udfff]` on the decoded str, where valid pairs are already one code
 * point.)
 */
const LONE_SURROGATE_RE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** True when the text holds characters that can't be stored (refused with `invalidCharacters`). */
export function hasInvalidCharacters(s: string): boolean {
  return s.includes('\u0000') || LONE_SURROGATE_RE.test(s);
}

export const leadFieldMessages = {
  // Definitions (Settings → Lead fields)
  labelRequired: 'יש להזין שם לשדה',
  labelTooLong: `שם השדה יכול להכיל עד ${LEAD_FIELD_LABEL_MAX} תווים`,
  labelTaken: 'כבר יש שדה פעיל בשם הזה',
  typeInvalid: 'יש לבחור סוג שדה',
  typeLocked: 'אי אפשר לשנות את סוג השדה. אפשר ליצור שדה חדש במקומו',
  optionsCount: `לשדה בחירה צריכות להיות בין ${LEAD_FIELD_OPTIONS_MIN} ל-${LEAD_FIELD_OPTIONS_MAX} אפשרויות`,
  optionsTotal: 'יש יותר מדי אפשרויות בארכיון של השדה הזה',
  optionsNotAllowed: 'רק לשדה בחירה יש אפשרויות',
  optionLabelRequired: 'יש להזין טקסט לאפשרות',
  optionLabelTooLong: `אפשרות יכולה להכיל עד ${LEAD_FIELD_OPTION_LABEL_MAX} תווים`,
  optionDuplicate: 'יש שתי אפשרויות עם אותו שם',
  optionUnknown: 'אחת האפשרויות אינה שייכת לשדה הזה',
  rangeNotAllowed: 'טווח ערכים אפשרי רק לשדה מספר',
  rangeInvalid: 'הערך המינימלי גדול מהמקסימלי',
  numberInvalid: 'יש להזין מספר',
  booleanNotRequired: 'שדה סימון לא יכול להיות שדה חובה',
  tooManyFields: `אפשר עד ${MAX_ACTIVE_LEAD_FIELDS} שדות פעילים. העבירו שדה לארכיון כדי להוסיף חדש`,
  orderDuplicate: 'שדה מופיע פעמיים ברשימה',
  orderStale: 'רשימת השדות השתנתה. רעננו את הדף ונסו שוב',
  // Values (a lead's customFields)
  valuesInvalid: 'השדות הנוספים אינם תקינים',
  tooManyValues: 'יש יותר מדי שדות נוספים בבקשה',
  valueUnknownField: 'השדה הזה לא קיים בעסק',
  valueArchivedField: 'השדה הועבר לארכיון ואי אפשר לעדכן אותו',
  valueRequired: 'זהו שדה חובה',
  valueText: 'יש להזין טקסט',
  valueTextTooLong: `הטקסט ארוך מדי (עד ${LEAD_FIELD_TEXT_MAX} תווים)`,
  valueNumber: 'יש להזין מספר',
  valueNumberMin: (min: number) => `המספר צריך להיות לפחות ${fmt(min)}`,
  valueNumberMax: (max: number) => `המספר צריך להיות לכל היותר ${fmt(max)}`,
  valueDate: 'יש להזין תאריך תקין',
  valueOption: 'יש לבחור אחת מהאפשרויות',
  valueBoolean: 'יש לסמן או לבטל את הסימון',
  // List filters
  filterInvalid: 'הסינון לפי שדה נוסף אינו תקין',
  // Any text (labels, option labels, text values, text filters): NUL or a lone UTF-16 surrogate,
  // which Postgres can't store.
  invalidCharacters: 'הטקסט מכיל תווים לא תקינים. מחקו אותם ונסו שוב',
} as const;

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

/** A stored value: text/date/select id → string, number → number, boolean → true. */
export const customFieldValueSchema = z.union([z.string(), z.number(), z.boolean()]);
export type CustomFieldValue = z.infer<typeof customFieldValueSchema>;

/** A lead's stored values, `{ [definitionId]: value }`. Empty values are never stored. */
export const customFieldValuesSchema = z.record(customFieldValueSchema);
export type CustomFieldValues = z.infer<typeof customFieldValuesSchema>;

/**
 * The shape a request may send (`null`/`""` = no value). Only the shape: the per-business check is
 * `buildCustomFieldsSchema` / `validateCustomFields` with that business's definitions.
 */
export const customFieldsInputSchema = z
  .record(z.union([z.string(), z.number(), z.boolean(), z.null()]), {
    invalid_type_error: leadFieldMessages.valuesInvalid,
  })
  .refine((v) => Object.keys(v).length <= MAX_CUSTOM_FIELD_KEYS, leadFieldMessages.tooManyValues);
export type CustomFieldsInput = z.input<typeof customFieldsInputSchema>;

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------

export const leadFieldOptionSchema = z.object({
  /** Stable id, generated by the server; a lead's select value is this id. */
  id: z.string().min(1).max(LEAD_FIELD_OPTION_ID_MAX),
  label: z.string(),
  /** Set when the option was removed: old values still show its label; it can't be chosen. */
  archivedAt: z.string().datetime().nullable(),
});
export type LeadFieldOption = z.infer<typeof leadFieldOptionSchema>;

/** A field definition as the API returns it. */
export const leadFieldDefinitionSchema = z.object({
  id: z.string().uuid(),
  /** The business's own text: shown as written (not translated), with `dir="auto"`. */
  label: z.string(),
  type: z.enum(LEAD_FIELD_TYPES),
  /** select only (active and archived, in display order); `[]` for other types. */
  options: z.array(leadFieldOptionSchema),
  /** Applies only when a person creates or edits a lead in the app. Never true for boolean. */
  required: z.boolean(),
  /** number only: optional inclusive bounds; null otherwise. */
  min: z.number().nullable(),
  max: z.number().nullable(),
  /** Order among the business's fields (0-based; archived fields keep theirs). */
  position: z.number().int(),
  archivedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type LeadFieldDefinition = z.infer<typeof leadFieldDefinitionSchema>;

/** What the value validator needs from a definition (wire definitions satisfy it). */
export type LeadFieldRule = Pick<
  LeadFieldDefinition,
  'id' | 'type' | 'required' | 'min' | 'max' | 'archivedAt'
> & { options: Pick<LeadFieldOption, 'id' | 'archivedAt'>[] };

const labelSchema = z
  .string({
    required_error: leadFieldMessages.labelRequired,
    invalid_type_error: leadFieldMessages.labelRequired,
  })
  .trim()
  .min(1, leadFieldMessages.labelRequired)
  .max(LEAD_FIELD_LABEL_MAX, leadFieldMessages.labelTooLong)
  .refine((s) => !hasInvalidCharacters(s), leadFieldMessages.invalidCharacters);

const optionLabelSchema = z
  .string({
    required_error: leadFieldMessages.optionLabelRequired,
    invalid_type_error: leadFieldMessages.optionLabelRequired,
  })
  .trim()
  .min(1, leadFieldMessages.optionLabelRequired)
  .max(LEAD_FIELD_OPTION_LABEL_MAX, leadFieldMessages.optionLabelTooLong)
  .refine((s) => !hasInvalidCharacters(s), leadFieldMessages.invalidCharacters);

const boundSchema = z
  .number({ invalid_type_error: leadFieldMessages.numberInvalid })
  .finite(leadFieldMessages.numberInvalid)
  .min(-LEAD_FIELD_NUMBER_ABS_MAX, leadFieldMessages.numberInvalid)
  .max(LEAD_FIELD_NUMBER_ABS_MAX, leadFieldMessages.numberInvalid)
  .nullable()
  .optional();

/**
 * Active options in display order, labels unique (case-insensitive). `counted`: 2–30 here; the create
 * schema counts them in `checkTypeRules` instead, since a non-select field may send `[]`.
 */
function optionListSchema<T extends z.ZodTypeAny>(item: T, counted: boolean) {
  const list = z.array(item, { invalid_type_error: leadFieldMessages.optionsCount });
  return (
    counted
      ? list
          .min(LEAD_FIELD_OPTIONS_MIN, leadFieldMessages.optionsCount)
          .max(LEAD_FIELD_OPTIONS_MAX, leadFieldMessages.optionsCount)
      : list
  ).superRefine((opts: { label: string }[], ctx) => {
    const seen = new Set<string>();
    opts.forEach((o, i) => {
      const key = o.label.toLocaleLowerCase();
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: leadFieldMessages.optionDuplicate,
          path: [i, 'label'],
        });
      }
      seen.add(key);
    });
  });
}

export const createLeadFieldOptionSchema = z.object({ label: optionLabelSchema });
/** On update: `id` = an existing option of this field (rename/restore); no id = a new option. */
export const updateLeadFieldOptionSchema = z.object({
  id: z.string().min(1).max(LEAD_FIELD_OPTION_ID_MAX).optional(),
  label: optionLabelSchema,
});

function checkTypeRules(
  v: {
    type: LeadFieldType;
    options?: unknown[];
    required?: boolean;
    min?: number | null;
    max?: number | null;
  },
  ctx: z.RefinementCtx,
) {
  if (
    v.type === 'select' &&
    (v.options === undefined ||
      v.options.length < LEAD_FIELD_OPTIONS_MIN ||
      v.options.length > LEAD_FIELD_OPTIONS_MAX)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: leadFieldMessages.optionsCount,
      path: ['options'],
    });
  }
  if (v.type !== 'select' && v.options !== undefined && v.options.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: leadFieldMessages.optionsNotAllowed,
      path: ['options'],
    });
  }
  if (v.type !== 'number' && (v.min != null || v.max != null)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: leadFieldMessages.rangeNotAllowed,
      path: ['min'],
    });
  }
  if (v.min != null && v.max != null && v.min > v.max) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: leadFieldMessages.rangeInvalid,
      path: ['min'],
    });
  }
  if (v.type === 'boolean' && v.required) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: leadFieldMessages.booleanNotRequired,
      path: ['required'],
    });
  }
}

/** POST /lead-fields. The server assigns ids (field and options) and puts the field last. */
export const createLeadFieldRequestSchema = z
  .object({
    label: labelSchema,
    type: z.enum(LEAD_FIELD_TYPES, {
      errorMap: () => ({ message: leadFieldMessages.typeInvalid }),
    }),
    /** select: 2–30 options. Other types: omit (or `[]`). */
    options: optionListSchema(createLeadFieldOptionSchema, false).optional(),
    required: z.boolean().optional().default(false),
    /** number only. */
    min: boundSchema,
    max: boundSchema,
  })
  .superRefine(checkTypeRules)
  .transform((v) => ({
    label: v.label,
    type: v.type,
    options: v.type === 'select' ? (v.options ?? []) : [],
    required: v.required,
    min: v.type === 'number' ? (v.min ?? null) : null,
    max: v.type === 'number' ? (v.max ?? null) : null,
  }));
export type CreateLeadFieldRequest = z.input<typeof createLeadFieldRequestSchema>;
export type CreateLeadFieldInput = z.output<typeof createLeadFieldRequestSchema>;

/**
 * PATCH /lead-fields/:fieldId. Every key optional. `type` is refused (it can't change).
 * `options` (select only) is the full list of **active** options in order: a listed id renames or
 * restores that option, an entry without id is new, and an existing option left out is archived
 * (never deleted). `archived: true` archives the field, `false` restores it (it goes last).
 * Type-dependent checks (options on a non-select field, a range on a non-number field, a required
 * boolean) are made by the server against the stored type.
 */
export const updateLeadFieldRequestSchema = z
  .object({
    label: labelSchema.optional(),
    options: optionListSchema(updateLeadFieldOptionSchema, true).optional(),
    required: z.boolean().optional(),
    min: boundSchema,
    max: boundSchema,
    archived: z.boolean().optional(),
    /** Present only to refuse it with a Hebrew message. */
    type: z.undefined({ invalid_type_error: leadFieldMessages.typeLocked }).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.min != null && v.max != null && v.min > v.max) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: leadFieldMessages.rangeInvalid,
        path: ['min'],
      });
    }
  })
  .transform(({ type: _type, ...rest }) => rest);
export type UpdateLeadFieldRequest = z.input<typeof updateLeadFieldRequestSchema>;

/** PUT /lead-fields/order: every active field id, once, in the new order. */
export const reorderLeadFieldsRequestSchema = z.object({
  ids: z
    .array(z.string().uuid(leadFieldMessages.orderStale))
    .max(MAX_ACTIVE_LEAD_FIELDS, leadFieldMessages.orderStale)
    .refine((ids) => new Set(ids).size === ids.length, leadFieldMessages.orderDuplicate),
});
export type ReorderLeadFieldsRequest = z.infer<typeof reorderLeadFieldsRequestSchema>;

/** GET /lead-fields and PUT /lead-fields/order: active by position, then archived by position. */
export const leadFieldListResponseSchema = z.object({ fields: z.array(leadFieldDefinitionSchema) });
export type LeadFieldListResponse = z.infer<typeof leadFieldListResponseSchema>;
export const leadFieldResponseSchema = z.object({ field: leadFieldDefinitionSchema });
export type LeadFieldResponse = z.infer<typeof leadFieldResponseSchema>;

// ---------------------------------------------------------------------------
// Per-business value validation
// ---------------------------------------------------------------------------

export interface CustomFieldsValidationOptions {
  /**
   * 'create': the whole set of values for a new lead; empty values are dropped.
   * 'update': a patch (PATCH /leads/:id); only the keys sent change, and an empty value means
   * "remove this value" (it comes back as `null`).
   */
  mode: 'create' | 'update';
  /**
   * Whether `required` is enforced (D-203, D-205). True for the full New lead dialog (a create
   * without `skipRequiredCustomFields`) and for edits on the lead card. False for quick "add
   * customer" paths in the app (`skipRequiredCustomFields: true`) and for the website form,
   * WhatsApp, Messenger, email, the embed script and import. Values sent are validated either way.
   * For POST /leads use `createLeadCustomFieldsOptions(body)` rather than setting it by hand.
   */
  fromApp: boolean;
  /**
   * The lead's stored values (update). A key sent with its stored value unchanged passes even if
   * the field or the option was archived since, so a full form can be sent back as it is.
   */
  existing?: CustomFieldValues;
}

/**
 * Validator options for POST /leads (in-app create), from the request body: required fields are
 * enforced unless the body says `skipRequiredCustomFields: true` (D-205). The API and the web both
 * use this so the rule lives in one place.
 */
export function createLeadCustomFieldsOptions(body: {
  skipRequiredCustomFields?: boolean;
}): CustomFieldsValidationOptions & { mode: 'create' } {
  return { mode: 'create', fromApp: body.skipRequiredCustomFields !== true };
}

/** A patch: `null` removes the stored value. */
export type CustomFieldsPatch = Record<string, CustomFieldValue | null>;

export type CustomFieldsValidationResult<T> =
  | { ok: true; values: T }
  /** `fields` keys are `customFields.<fieldId>` (or `customFields`), as in the API's error body. */
  | { ok: false; fields: Record<string, string> };

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const NUMBER_RE = /^-?\d+(\.\d+)?$/;

export function isValidIsoDate(s: string): boolean {
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

type Checked = { ok: true; value: CustomFieldValue | null } | { ok: false; message: string };

/** Normalises one value for its field; `null` = no value. Ignores required and archiving. */
export function normalizeCustomFieldValue(rule: LeadFieldRule, raw: unknown): Checked {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  switch (rule.type) {
    case 'text': {
      if (typeof raw !== 'string') return { ok: false, message: leadFieldMessages.valueText };
      const s = raw.replace(/\s*[\r\n]+\s*/g, ' ').trim();
      if (!s) return { ok: true, value: null };
      if (hasInvalidCharacters(s)) {
        return { ok: false, message: leadFieldMessages.invalidCharacters };
      }
      if (s.length > LEAD_FIELD_TEXT_MAX) {
        return { ok: false, message: leadFieldMessages.valueTextTooLong };
      }
      return { ok: true, value: s };
    }
    case 'number': {
      let n: number;
      if (typeof raw === 'number') n = raw;
      else if (typeof raw === 'string') {
        const s = raw.trim();
        if (!s) return { ok: true, value: null };
        if (!NUMBER_RE.test(s)) return { ok: false, message: leadFieldMessages.valueNumber };
        n = Number(s);
      } else return { ok: false, message: leadFieldMessages.valueNumber };
      if (!Number.isFinite(n) || Math.abs(n) > LEAD_FIELD_NUMBER_ABS_MAX) {
        return { ok: false, message: leadFieldMessages.valueNumber };
      }
      if (rule.min != null && n < rule.min) {
        return { ok: false, message: leadFieldMessages.valueNumberMin(rule.min) };
      }
      if (rule.max != null && n > rule.max) {
        return { ok: false, message: leadFieldMessages.valueNumberMax(rule.max) };
      }
      return { ok: true, value: n };
    }
    case 'date': {
      if (typeof raw !== 'string') return { ok: false, message: leadFieldMessages.valueDate };
      const s = raw.trim();
      if (!s) return { ok: true, value: null };
      return isValidIsoDate(s)
        ? { ok: true, value: s }
        : { ok: false, message: leadFieldMessages.valueDate };
    }
    case 'select': {
      if (typeof raw !== 'string') return { ok: false, message: leadFieldMessages.valueOption };
      const s = raw.trim();
      if (!s) return { ok: true, value: null };
      const opt = rule.options.find((o) => o.id === s);
      return opt && !opt.archivedAt
        ? { ok: true, value: s }
        : { ok: false, message: leadFieldMessages.valueOption };
    }
    case 'boolean': {
      // Unticked = no value (D-204, proposed): only `true` is stored.
      if (typeof raw !== 'boolean') return { ok: false, message: leadFieldMessages.valueBoolean };
      return { ok: true, value: raw ? true : null };
    }
  }
}

/**
 * Checks a lead's `customFields` against one business's definitions (active and archived).
 * Unknown keys (including another business's field ids), wrong types, unknown or archived
 * options, over-long text and archived fields are refused per field; `required` only when
 * `fromApp`. In 'create' mode empty values are dropped; in 'update' mode they come back as `null`.
 */
export function validateCustomFields(
  rules: readonly LeadFieldRule[],
  input: unknown,
  opts: CustomFieldsValidationOptions & { mode: 'create' },
): CustomFieldsValidationResult<CustomFieldValues>;
export function validateCustomFields(
  rules: readonly LeadFieldRule[],
  input: unknown,
  opts: CustomFieldsValidationOptions & { mode: 'update' },
): CustomFieldsValidationResult<CustomFieldsPatch>;
export function validateCustomFields(
  rules: readonly LeadFieldRule[],
  input: unknown,
  opts: CustomFieldsValidationOptions,
): CustomFieldsValidationResult<CustomFieldValues | CustomFieldsPatch>;
export function validateCustomFields(
  rules: readonly LeadFieldRule[],
  input: unknown,
  opts: CustomFieldsValidationOptions,
): CustomFieldsValidationResult<CustomFieldValues | CustomFieldsPatch> {
  const fields: Record<string, string> = {};
  const raw = input ?? {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, fields: { customFields: leadFieldMessages.valuesInvalid } };
  }
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > MAX_CUSTOM_FIELD_KEYS) {
    return { ok: false, fields: { customFields: leadFieldMessages.tooManyValues } };
  }
  const byId = new Map(rules.map((r) => [r.id, r]));
  const existing = opts.existing ?? {};
  const out: CustomFieldsPatch = {};

  for (const [key, value] of entries) {
    const path = `customFields.${key}`;
    const rule = byId.get(key);
    if (!rule) {
      fields[path] = leadFieldMessages.valueUnknownField;
      continue;
    }
    // A stored value sent back unchanged is always fine (archived field or option included).
    if (opts.mode === 'update' && key in existing && existing[key] === value) {
      out[key] = value as CustomFieldValue;
      continue;
    }
    if (rule.archivedAt) {
      fields[path] = leadFieldMessages.valueArchivedField;
      continue;
    }
    const checked = normalizeCustomFieldValue(rule, value);
    if (!checked.ok) {
      fields[path] = checked.message;
      continue;
    }
    if (checked.value === null && opts.fromApp && rule.required) {
      fields[path] = leadFieldMessages.valueRequired;
      continue;
    }
    if (checked.value !== null || opts.mode === 'update') out[key] = checked.value;
  }

  if (opts.mode === 'create' && opts.fromApp) {
    for (const rule of rules) {
      const path = `customFields.${rule.id}`;
      if (rule.required && !rule.archivedAt && out[rule.id] == null && !fields[path]) {
        fields[path] = leadFieldMessages.valueRequired;
      }
    }
  }

  return Object.keys(fields).length ? { ok: false, fields } : { ok: true, values: out };
}

/**
 * The same check as a Zod schema, for forms (`zodResolver`). Issue paths are `[fieldId]`
 * relative to `customFields`; nest it under `customFields` in the form's schema.
 */
export function buildCustomFieldsSchema(
  rules: readonly LeadFieldRule[],
  opts: CustomFieldsValidationOptions & { mode: 'create' },
): z.ZodType<CustomFieldValues, z.ZodTypeDef, unknown>;
export function buildCustomFieldsSchema(
  rules: readonly LeadFieldRule[],
  opts: CustomFieldsValidationOptions & { mode: 'update' },
): z.ZodType<CustomFieldsPatch, z.ZodTypeDef, unknown>;
export function buildCustomFieldsSchema(
  rules: readonly LeadFieldRule[],
  opts: CustomFieldsValidationOptions,
): z.ZodType<CustomFieldValues | CustomFieldsPatch, z.ZodTypeDef, unknown> {
  return z.unknown().transform((input, ctx) => {
    const r = validateCustomFields(rules, input, opts);
    if (r.ok) return r.values;
    for (const [key, message] of Object.entries(r.fields)) {
      const id = key.startsWith('customFields.') ? key.slice('customFields.'.length) : null;
      ctx.addIssue({ code: z.ZodIssueCode.custom, message, path: id ? [id] : [] });
    }
    return z.NEVER;
  });
}

/** Applies a validated patch to stored values: `null` removes a key. */
export function applyCustomFieldsPatch(
  existing: CustomFieldValues,
  patch: CustomFieldsPatch,
): CustomFieldValues {
  const next: CustomFieldValues = { ...existing };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete next[key];
    else next[key] = value;
  }
  return next;
}

// ---------------------------------------------------------------------------
// History (lead.updated activity)
// ---------------------------------------------------------------------------

export const customFieldChangeSchema = z.object({
  fieldId: z.string().uuid(),
  /** `null` = no value. A select's values are option ids; show them by the option's label. */
  from: customFieldValueSchema.nullable(),
  to: customFieldValueSchema.nullable(),
});
export type CustomFieldChange = z.infer<typeof customFieldChangeSchema>;

/**
 * `data` of a `lead.updated` activity. `fields` lists the changed fixed fields and, when any custom
 * value changed, `"customFields"`; `customFields` holds one entry per changed custom field.
 */
export const leadUpdatedActivityDataSchema = z.object({
  fields: z.array(z.string()),
  customFields: z.array(customFieldChangeSchema).optional(),
});
export type LeadUpdatedActivityData = z.infer<typeof leadUpdatedActivityDataSchema>;

/** The changes between two sets of stored values, in key order of `after` then removed keys. */
export function diffCustomFields(
  before: CustomFieldValues,
  after: CustomFieldValues,
): CustomFieldChange[] {
  const changes: CustomFieldChange[] = [];
  for (const [fieldId, to] of Object.entries(after)) {
    const from = before[fieldId] ?? null;
    if (from !== to) changes.push({ fieldId, from, to });
  }
  for (const [fieldId, from] of Object.entries(before)) {
    if (!(fieldId in after)) changes.push({ fieldId, from, to: null });
  }
  return changes;
}

// ---------------------------------------------------------------------------
// Leads list filters: cf[<fieldId>]=value, cf[<fieldId>][from]=…, cf[<fieldId>][to]=…
// ---------------------------------------------------------------------------

/**
 * One field's filter. text: `value` (contains, case-insensitive); select: `value` (option id,
 * equals); boolean: `value` `'true'` / `'false'` (false = not ticked); number and date: `from`
 * and/or `to` (inclusive; numbers as decimal strings, dates `YYYY-MM-DD`).
 */
export interface LeadFieldFilter {
  value?: string;
  from?: string;
  to?: string;
}
export type LeadFieldFilters = Record<string, LeadFieldFilter>;

export const LEAD_FIELD_FILTER_PARAM_RE =
  /^cf\[([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\](?:\[(from|to)\])?$/i;

/** A filter value worth sending: not empty and free of characters that can't be stored. */
const usableFilterValue = (v: string | undefined): v is string => !!v && !hasInvalidCharacters(v);

/**
 * Query-string pairs for the filters; empty parts, and parts with invalid characters (the API
 * refuses those with 400 `invalidCharacters`), are left out.
 */
export function leadFieldFilterParams(filters: LeadFieldFilters): [string, string][] {
  const out: [string, string][] = [];
  for (const [id, f] of Object.entries(filters)) {
    if (usableFilterValue(f.value)) out.push([`cf[${id}]`, f.value]);
    if (usableFilterValue(f.from)) out.push([`cf[${id}][from]`, f.from]);
    if (usableFilterValue(f.to)) out.push([`cf[${id}][to]`, f.to]);
  }
  return out;
}

/**
 * Reads `cf[...]` pairs back (e.g. from the page URL); other params, empty values and values with
 * invalid characters (NUL, lone surrogates) are dropped.
 */
export function parseLeadFieldFilterParams(params: Iterable<[string, string]>): LeadFieldFilters {
  const out: LeadFieldFilters = {};
  for (const [key, raw] of params) {
    const m = LEAD_FIELD_FILTER_PARAM_RE.exec(key);
    const value = raw.trim();
    if (!m || !usableFilterValue(value)) continue;
    const id = m[1]!.toLowerCase();
    const part = (m[2] ?? 'value') as keyof LeadFieldFilter;
    out[id] = { ...out[id], [part]: value };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

export const leadFieldsApiPaths = {
  list: (businessId: string) => `/api/v1/businesses/${businessId}/lead-fields`,
  detail: (businessId: string, fieldId: string) =>
    `/api/v1/businesses/${businessId}/lead-fields/${fieldId}`,
  order: (businessId: string) => `/api/v1/businesses/${businessId}/lead-fields/order`,
} as const;
