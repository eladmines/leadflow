import { z } from 'zod';
import { roleSchema } from './permissions';

/**
 * F02 — Business onboarding & tenancy contract.
 *
 * Request schemas may normalise values (phone → E.164, blank address → null). Web forms that
 * use them with zodResolver receive the normalised output in `handleSubmit`.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const BUSINESS_NAME_MIN_LENGTH = 2;
export const BUSINESS_NAME_MAX_LENGTH = 80;
export const ADDRESS_MAX_LENGTH = 200;
export const SERVICE_AREA_MAX_LENGTH = 60;
export const SERVICE_AREAS_MAX = 30;
export const DEFAULT_TIMEZONE = 'Asia/Jerusalem';

/** Wizard: 1 name + industry · 2 phone + address · 3 service areas · 4 opening hours. */
export const ONBOARDING_STEPS = 4;

export const BUSINESS_STATUSES = ['ONBOARDING', 'ACTIVE', 'SUSPENDED'] as const;
export const businessStatusSchema = z.enum(BUSINESS_STATUSES);
export type BusinessStatus = z.infer<typeof businessStatusSchema>;

/** Industries from the PRD's target audience (§1). Stored as the code. */
export const INDUSTRIES = ['trades', 'beauty', 'studio', 'garage', 'services', 'other'] as const;
export const industryLabels: Record<(typeof INDUSTRIES)[number], string> = {
  trades: 'בעלי מקצוע (חשמל, אינסטלציה, שיפוצים)',
  beauty: 'מספרה וקוסמטיקה',
  studio: 'סטודיו וכושר',
  garage: 'מוסך',
  services: 'נותני שירות',
  other: 'אחר',
};

export const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export const weekdayLabels: Record<Weekday, string> = {
  sun: 'ראשון',
  mon: 'שני',
  tue: 'שלישי',
  wed: 'רביעי',
  thu: 'חמישי',
  fri: 'שישי',
  sat: 'שבת',
};

export const businessMessages = {
  nameRequired: 'יש להזין את שם העסק',
  nameTooShort: `שם העסק צריך להכיל לפחות ${BUSINESS_NAME_MIN_LENGTH} תווים`,
  nameTooLong: `שם העסק יכול להכיל עד ${BUSINESS_NAME_MAX_LENGTH} תווים`,
  industryRequired: 'יש לבחור תחום פעילות',
  phoneRequired: 'יש להזין מספר טלפון',
  phoneInvalid: 'מספר הטלפון אינו תקין. לדוגמה: 050-1234567',
  addressTooLong: `הכתובת יכולה להכיל עד ${ADDRESS_MAX_LENGTH} תווים`,
  serviceAreaTooLong: `כל אזור שירות יכול להכיל עד ${SERVICE_AREA_MAX_LENGTH} תווים`,
  serviceAreasTooMany: `אפשר להוסיף עד ${SERVICE_AREAS_MAX} אזורי שירות`,
  timeInvalid: 'יש להזין שעה בפורמט 09:00',
  hoursRange: 'שעת הסגירה צריכה להיות אחרי שעת הפתיחה',
  onboardingIncomplete: 'כדי לסיים את ההקמה יש להשלים את שם העסק, התחום ומספר הטלפון',
} as const;

// ---------------------------------------------------------------------------
// Israeli phone numbers
// ---------------------------------------------------------------------------

/**
 * Normalises an Israeli phone number to E.164 (`+972…`), or returns null when invalid.
 * Accepts 050-1234567, 03-1234567, 0501234567, +972 50 123 4567, 972501234567.
 * National numbers: mobile/VoIP 5X/7X + 7 digits; landline 2,3,4,8,9 + 7 digits.
 */
export function normalizeIsraeliPhone(raw: string): string | null {
  const trimmed = raw.trim();
  if (!/^\+?[\d\s\-().]+$/.test(trimmed)) return null;
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');

  let national: string;
  if (digits.startsWith('972')) national = digits.slice(3).replace(/^0/, '');
  else if (!hasPlus && digits.startsWith('0')) national = digits.slice(1);
  else return null;

  return /^([57]\d{8}|[23489]\d{7})$/.test(national) ? `+972${national}` : null;
}

/** E.164 → local display form, e.g. `+972501234567` → `050-1234567`. */
export function formatIsraeliPhone(e164: string): string {
  if (!e164.startsWith('+972')) return e164;
  const local = `0${e164.slice(4)}`;
  const prefixLength = local.length === 10 ? 3 : 2;
  return `${local.slice(0, prefixLength)}-${local.slice(prefixLength)}`;
}

// ---------------------------------------------------------------------------
// Field schemas
// ---------------------------------------------------------------------------

const requiredString = (message: string) =>
  z.string({ required_error: message, invalid_type_error: message });

export const businessNameSchema = requiredString(businessMessages.nameRequired)
  .trim()
  .min(1, businessMessages.nameRequired)
  .min(BUSINESS_NAME_MIN_LENGTH, businessMessages.nameTooShort)
  .max(BUSINESS_NAME_MAX_LENGTH, businessMessages.nameTooLong);

export const industrySchema = z.enum(INDUSTRIES, {
  errorMap: () => ({ message: businessMessages.industryRequired }),
});
export type Industry = z.infer<typeof industrySchema>;

/** Validates and normalises to E.164. */
export const phoneSchema = requiredString(businessMessages.phoneRequired)
  .trim()
  .min(1, businessMessages.phoneRequired)
  .refine((v) => normalizeIsraeliPhone(v) !== null, businessMessages.phoneInvalid)
  .transform((v) => normalizeIsraeliPhone(v) as string);

/** Optional address: trimmed; blank becomes null. */
export const addressSchema = z
  .string()
  .trim()
  .max(ADDRESS_MAX_LENGTH, businessMessages.addressTooLong)
  .nullable()
  .transform((v) => (v ? v : null));

export const serviceAreasSchema = z
  .array(z.string().trim().min(1).max(SERVICE_AREA_MAX_LENGTH, businessMessages.serviceAreaTooLong))
  .max(SERVICE_AREAS_MAX, businessMessages.serviceAreasTooMany)
  // Case-insensitive de-duplication, keeping the first spelling.
  .transform((areas) =>
    areas.filter((a, i) => areas.findIndex((b) => b.toLowerCase() === a.toLowerCase()) === i),
  );

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, businessMessages.timeInvalid);

export const dayHoursSchema = z
  .object({ open: z.boolean(), from: timeSchema, to: timeSchema })
  .refine((d) => !d.open || d.from < d.to, {
    message: businessMessages.hoursRange,
    path: ['to'],
  });
export type DayHours = z.infer<typeof dayHoursSchema>;

export const openingHoursSchema = z.object({
  sun: dayHoursSchema,
  mon: dayHoursSchema,
  tue: dayHoursSchema,
  wed: dayHoursSchema,
  thu: dayHoursSchema,
  fri: dayHoursSchema,
  sat: dayHoursSchema,
});
export type OpeningHours = z.infer<typeof openingHoursSchema>;

/** Suggested starting point in the wizard (the owner edits it). */
export const defaultOpeningHours: OpeningHours = {
  sun: { open: true, from: '09:00', to: '18:00' },
  mon: { open: true, from: '09:00', to: '18:00' },
  tue: { open: true, from: '09:00', to: '18:00' },
  wed: { open: true, from: '09:00', to: '18:00' },
  thu: { open: true, from: '09:00', to: '18:00' },
  fri: { open: true, from: '09:00', to: '13:00' },
  sat: { open: false, from: '09:00', to: '18:00' },
};

const onboardingStepSchema = z.number().int().min(1).max(ONBOARDING_STEPS);

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export const createBusinessRequestSchema = z.object({
  name: businessNameSchema,
  industry: industrySchema,
});
export type CreateBusinessRequest = z.infer<typeof createBusinessRequestSchema>;

/** Wizard step 2: phone is required here (it's needed to finish onboarding); address is optional. */
export const onboardingContactSchema = z.object({
  phone: phoneSchema,
  address: addressSchema,
});
export type OnboardingContact = z.infer<typeof onboardingContactSchema>;

/** Settings → business details form (the owner edits these after onboarding). */
export const businessDetailsSchema = z.object({
  name: businessNameSchema,
  industry: industrySchema,
  phone: phoneSchema,
  address: addressSchema,
});
export type BusinessDetails = z.infer<typeof businessDetailsSchema>;

/**
 * PATCH: every field optional; unknown keys (id, status, role, businessId…) are stripped, never
 * applied. `onboardingStep` saves wizard progress and is ignored once the business is ACTIVE.
 */
export const updateBusinessRequestSchema = z.object({
  name: businessNameSchema.optional(),
  industry: industrySchema.optional(),
  phone: phoneSchema.nullable().optional(),
  address: addressSchema.optional(),
  serviceAreas: serviceAreasSchema.optional(),
  openingHours: openingHoursSchema.nullable().optional(),
  onboardingStep: onboardingStepSchema.optional(),
});
export type UpdateBusinessRequest = z.input<typeof updateBusinessRequestSchema>;

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export const businessSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  industry: industrySchema,
  phone: z.string().nullable(),
  address: z.string().nullable(),
  serviceAreas: z.array(z.string()),
  openingHours: openingHoursSchema.nullable(),
  timezone: z.string(),
  status: businessStatusSchema,
  onboardingStep: z.number().int(),
  /** The caller's role in this business. */
  role: roleSchema,
  createdAt: z.string().datetime(),
});
export type Business = z.infer<typeof businessSchema>;

export const businessResponseSchema = z.object({ business: businessSchema });
export type BusinessResponse = z.infer<typeof businessResponseSchema>;

export const businessSummarySchema = businessSchema.pick({
  id: true,
  name: true,
  status: true,
  onboardingStep: true,
  role: true,
});
export type BusinessSummary = z.infer<typeof businessSummarySchema>;

export const businessListResponseSchema = z.object({ businesses: z.array(businessSummarySchema) });
export type BusinessListResponse = z.infer<typeof businessListResponseSchema>;

export const memberSchema = z.object({
  userId: z.string().uuid(),
  fullName: z.string(),
  email: z.string(),
  role: roleSchema,
  joinedAt: z.string().datetime(),
});
export type Member = z.infer<typeof memberSchema>;

export const memberListResponseSchema = z.object({ members: z.array(memberSchema) });
export type MemberListResponse = z.infer<typeof memberListResponseSchema>;

export const businessAuditActions = [
  'business.created',
  'business.updated',
  'business.onboarding.completed',
] as const;

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

export const businessApiPaths = {
  list: '/api/v1/businesses',
  create: '/api/v1/businesses',
  /** Prefix of every tenant-scoped route (Fastify param syntax). */
  tenantPrefix: '/api/v1/businesses/:businessId',
  detail: (businessId: string) => `/api/v1/businesses/${businessId}`,
  completeOnboarding: (businessId: string) =>
    `/api/v1/businesses/${businessId}/onboarding/complete`,
  members: (businessId: string) => `/api/v1/businesses/${businessId}/members`,
} as const;

export const businessWebPaths = {
  onboarding: '/onboarding',
  onboardingFor: (businessId: string) => `/onboarding/${businessId}`,
  home: (businessId: string) => `/b/${businessId}`,
  /** A section inside the business workspace, e.g. `section(id, 'team')` → `/b/:id/team`. */
  section: (businessId: string, section: string) => `/b/${businessId}/${section}`,
} as const;
