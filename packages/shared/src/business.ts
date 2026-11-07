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
/** Wizard: 1 name + industry · 2 phone + address · 3 service areas · 4 opening hours. */
export const ONBOARDING_STEPS = 4;

export const BUSINESS_STATUSES = ['ONBOARDING', 'ACTIVE', 'SUSPENDED'] as const;
export const businessStatusSchema = z.enum(BUSINESS_STATUSES);
/** Industries from the PRD's target audience (§1). Stored as the code. */
export const INDUSTRIES = [
  'trades',
  'beauty',
  'studio',
  'garage',
  'events',
  'catering',
  'photo',
  'therapy',
  'tutoring',
  'services',
  'other',
] as const;
export const industryLabels: Record<(typeof INDUSTRIES)[number], string> = {
  trades: 'בעלי מקצוע (חשמל, אינסטלציה, שיפוצים)',
  beauty: 'מספרה וקוסמטיקה',
  studio: 'סטודיו וכושר',
  garage: 'מוסך',
  events: 'די־ג׳יי והפקת אירועים',
  catering: 'שף וקייטרינג',
  photo: 'צילום',
  therapy: 'טיפול ואימון אישי',
  tutoring: 'מורים ושיעורים פרטיים',
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
  websiteInvalid: 'כתובת האתר אינה תקינה. לדוגמה: www.my-business.co.il',
  websiteTooLong: 'כתובת האתר ארוכה מדי',
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

/**
 * Countries for the phone field's code picker (D-121): ISO code and dialling code. Names come
 * from `Intl.DisplayNames` in the viewer's language. Israel first; +1 resolves to the US.
 */
export const PHONE_COUNTRIES = [
  { iso: 'IL', dial: '972' },
  { iso: 'US', dial: '1' },
  { iso: 'CA', dial: '1' },
  { iso: 'GB', dial: '44' },
  { iso: 'IE', dial: '353' },
  { iso: 'FR', dial: '33' },
  { iso: 'DE', dial: '49' },
  { iso: 'ES', dial: '34' },
  { iso: 'IT', dial: '39' },
  { iso: 'PT', dial: '351' },
  { iso: 'NL', dial: '31' },
  { iso: 'BE', dial: '32' },
  { iso: 'CH', dial: '41' },
  { iso: 'AT', dial: '43' },
  { iso: 'SE', dial: '46' },
  { iso: 'NO', dial: '47' },
  { iso: 'DK', dial: '45' },
  { iso: 'FI', dial: '358' },
  { iso: 'PL', dial: '48' },
  { iso: 'CZ', dial: '420' },
  { iso: 'HU', dial: '36' },
  { iso: 'RO', dial: '40' },
  { iso: 'GR', dial: '30' },
  { iso: 'CY', dial: '357' },
  { iso: 'UA', dial: '380' },
  { iso: 'RU', dial: '7' },
  { iso: 'TR', dial: '90' },
  { iso: 'AE', dial: '971' },
  { iso: 'SA', dial: '966' },
  { iso: 'JO', dial: '962' },
  { iso: 'EG', dial: '20' },
  { iso: 'MA', dial: '212' },
  { iso: 'ZA', dial: '27' },
  { iso: 'IN', dial: '91' },
  { iso: 'TH', dial: '66' },
  { iso: 'SG', dial: '65' },
  { iso: 'HK', dial: '852' },
  { iso: 'JP', dial: '81' },
  { iso: 'KR', dial: '82' },
  { iso: 'CN', dial: '86' },
  { iso: 'PH', dial: '63' },
  { iso: 'AU', dial: '61' },
  { iso: 'NZ', dial: '64' },
  { iso: 'BR', dial: '55' },
  { iso: 'MX', dial: '52' },
  { iso: 'AR', dial: '54' },
  { iso: 'CL', dial: '56' },
  { iso: 'CO', dial: '57' },
] as const;
export type PhoneCountry = (typeof PHONE_COUNTRIES)[number]['iso'];

const countryOf = (iso: string) => PHONE_COUNTRIES.find((c) => c.iso === iso);
/** The country whose dialling code starts these digits (longest code wins). */
function countryByDigits(digits: string) {
  return [...PHONE_COUNTRIES]
    .sort((a, b) => b.dial.length - a.dial.length)
    .find((c) => digits.startsWith(c.dial));
}

/**
 * Normalises any phone number to E.164, or null (D-121). Israeli numbers keep their exact rules
 * (and local forms like 050-1234567 stay Israeli by default). Other countries: `+<code>` (or a
 * local number with `country`), a leading trunk 0 dropped, 6–12 national digits.
 */
export function normalizePhone(raw: string, country: string = 'IL'): string | null {
  const trimmed = raw.trim();
  if (!/^\+?[\d\s\-().]+$/.test(trimmed)) return null;
  const international = trimmed.startsWith('+') || /^00[1-9]/.test(trimmed.replace(/\D/g, ''));
  let digits = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('+') === false && international) digits = digits.slice(2);

  let match = international ? countryByDigits(digits) : countryOf(country);
  if (!match) return null;
  if (match.iso === 'IL' || (!international && country === 'IL')) {
    return normalizeIsraeliPhone(international ? `+${digits}` : trimmed);
  }
  if (match.dial === '1') match = countryOf('US')!;
  const national = (international ? digits.slice(match.dial.length) : digits).replace(/^0/, '');
  return /^\d{6,12}$/.test(national) ? `+${match.dial}${national}` : null;
}

/** E.164 → its country and the national part for editing (Israeli numbers in local form). */
export function splitPhone(e164: string | null | undefined): {
  country: PhoneCountry | null;
  national: string;
} {
  if (!e164) return { country: null, national: '' };
  const digits = e164.replace(/\D/g, '');
  const c = e164.startsWith('+') ? countryByDigits(digits) : undefined;
  if (!c) return { country: null, national: e164 };
  if (c.iso === 'IL') return { country: 'IL', national: formatIsraeliPhone(e164) };
  return { country: c.dial === '1' ? 'US' : c.iso, national: digits.slice(c.dial.length) };
}

/**
 * E.164 → display form: Israeli numbers locally (`+972501234567` → `050-1234567`), others with
 * their code (`+447700900123` → `+44 7700900123`).
 */
export function formatIsraeliPhone(e164: string): string {
  if (!e164.startsWith('+972')) {
    const c = e164.startsWith('+') ? countryByDigits(e164.slice(1)) : undefined;
    return c ? `+${c.dial} ${e164.slice(1 + c.dial.length)}` : e164;
  }
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

/** Validates and normalises to E.164: Israeli local forms, or any country with `+<code>` (D-121). */
export const phoneSchema = requiredString(businessMessages.phoneRequired)
  .trim()
  .min(1, businessMessages.phoneRequired)
  .refine((v) => normalizePhone(v) !== null, businessMessages.phoneInvalid)
  .transform((v) => normalizePhone(v) as string);

/** Optional address: trimmed; blank becomes null. */
export const addressSchema = z
  .string()
  .trim()
  .max(ADDRESS_MAX_LENGTH, businessMessages.addressTooLong)
  .nullable()
  .transform((v) => (v ? v : null));

/**
 * The business's own website outside LeadFlow (D-094), shown in "האתר שלי" but never managed by
 * LeadFlow. Optional: blank becomes null; "www.x.co.il" gets https://; only http(s) addresses with a
 * real host name are accepted.
 */
export const websiteUrlSchema = z
  .string()
  .trim()
  .max(300, businessMessages.websiteTooLong)
  .nullable()
  .transform((v) => (v ? (/^https?:\/\//i.test(v) ? v : `https://${v}`) : null))
  .refine((v) => {
    if (v === null) return true;
    try {
      const url = new URL(v);
      return /^https?:$/.test(url.protocol) && /\.[a-z]{2,}$/i.test(url.hostname);
    } catch {
      return false;
    }
  }, businessMessages.websiteInvalid);

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
  websiteUrl: websiteUrlSchema.optional(),
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
  /** Existing website outside LeadFlow (D-094); null = none. */
  websiteUrl: z.string().nullable(),
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

/** The signed-in member's email preferences for this business. */
export const notificationPrefsSchema = z.object({
  /** Email on every new website lead (sent to owners and managers only). */
  newLeadEmail: z.boolean(),
});
export type NotificationPrefs = z.infer<typeof notificationPrefsSchema>;
export const notificationPrefsResponseSchema = z.object({ prefs: notificationPrefsSchema });
export type NotificationPrefsResponse = z.infer<typeof notificationPrefsResponseSchema>;

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
  notifications: (businessId: string) => `/api/v1/businesses/${businessId}/me/notifications`,
} as const;

export const businessWebPaths = {
  onboarding: '/onboarding',
  onboardingFor: (businessId: string) => `/onboarding/${businessId}`,
  home: (businessId: string) => `/b/${businessId}`,
  /** A section inside the business workspace, e.g. `section(id, 'team')` → `/b/:id/team`. */
  section: (businessId: string, section: string) => `/b/${businessId}/${section}`,
} as const;
