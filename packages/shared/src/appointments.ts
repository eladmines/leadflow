import { z } from 'zod';
import { phoneSchema } from './business';

/**
 * F17 — Appointments (PRD §7, §19.6): services with a duration, a calendar of appointments with
 * customer, service, staff member, time, notes and status, and no double booking per staff member.
 * Website booking requests arrive as REQUESTED and are confirmed manually (first version).
 */

export const APPOINTMENT_STATUSES = [
  'REQUESTED',
  'CONFIRMED',
  'COMPLETED',
  'NO_SHOW',
  'CANCELLED',
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];
export const appointmentStatusLabels: Record<AppointmentStatus, string> = {
  REQUESTED: 'ממתין לאישור',
  CONFIRMED: 'מאושר',
  COMPLETED: 'בוצע',
  NO_SHOW: 'לא הגיע/ה',
  CANCELLED: 'בוטל',
};
/** Statuses that hold the staff member's time (and so can clash). */
export const BLOCKING_STATUSES: AppointmentStatus[] = ['REQUESTED', 'CONFIRMED'];

export const appointmentMessages = {
  nameRequired: 'יש להזין שם לשירות',
  nameTooLong: 'השם ארוך מדי (עד 80 תווים)',
  durationInvalid: 'משך בין 5 דקות ל־8 שעות',
  priceInvalid: 'יש להזין מחיר בשקלים (מספר שלם)',
  startRequired: 'יש לבחור מועד',
  customerRequired: 'יש לבחור ליד או להזין שם וטלפון של הלקוח',
  customerNameRequired: 'יש להזין שם לקוח',
  notesTooLong: 'ההערות ארוכות מדי (עד 1,000 תווים)',
  serviceInvalid: 'השירות שנבחר אינו קיים',
  staffInvalid: 'אפשר לשבץ רק חבר צוות פעיל בעסק',
  leadInvalid: 'הליד שנבחר אינו קיים',
  clash: 'יש כבר תור בזמן הזה לאותו איש צוות. בחרו שעה אחרת או איש צוות אחר.',
  staffRequired: 'כדי לאשר תור יש לשבץ איש צוות',
} as const;

const duration = z
  .number({ invalid_type_error: appointmentMessages.durationInvalid })
  .int(appointmentMessages.durationInvalid)
  .min(5, appointmentMessages.durationInvalid)
  .max(480, appointmentMessages.durationInvalid);

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

export const serviceSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  durationMin: z.number().int(),
  /** Whole shekels; null = not shown. */
  price: z.number().int().nullable(),
  active: z.boolean(),
});
export type Service = z.infer<typeof serviceSchema>;

export const upsertServiceRequestSchema = z.object({
  name: z
    .string({ required_error: appointmentMessages.nameRequired })
    .trim()
    .min(1, appointmentMessages.nameRequired)
    .max(80, appointmentMessages.nameTooLong),
  durationMin: duration,
  price: z
    .number({ invalid_type_error: appointmentMessages.priceInvalid })
    .int(appointmentMessages.priceInvalid)
    .min(0, appointmentMessages.priceInvalid)
    .max(1_000_000, appointmentMessages.priceInvalid)
    .nullable()
    .default(null),
  active: z.boolean().default(true),
});
export type UpsertServiceRequest = z.input<typeof upsertServiceRequestSchema>;
export const serviceListResponseSchema = z.object({ services: z.array(serviceSchema) });
export type ServiceListResponse = z.infer<typeof serviceListResponseSchema>;
export const serviceResponseSchema = z.object({ service: serviceSchema });

// ---------------------------------------------------------------------------
// Appointments
// ---------------------------------------------------------------------------

export const appointmentSchema = z.object({
  id: z.string().uuid(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  status: z.enum(APPOINTMENT_STATUSES),
  notes: z.string().nullable(),
  source: z.enum(['manual', 'website']),
  service: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
  staff: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
  customer: z.object({
    id: z.string().uuid(),
    name: z.string(),
    phone: z.string().nullable(),
  }),
  lead: z.object({ id: z.string().uuid() }).nullable(),
  createdAt: z.string().datetime(),
});
export type Appointment = z.infer<typeof appointmentSchema>;

const notes = z
  .string()
  .trim()
  .max(1000, appointmentMessages.notesTooLong)
  .optional()
  .transform((v) => (v ? v : null));
const startsAt = z
  .string({ required_error: appointmentMessages.startRequired })
  .datetime({ message: appointmentMessages.startRequired });

/**
 * POST /appointments. The customer is an existing lead (`leadId`) or a name + phone (an existing
 * contact with that phone is reused). Duration defaults to the service's.
 */
export const createAppointmentRequestSchema = z
  .object({
    startsAt,
    durationMin: duration.optional(),
    serviceId: z.string().uuid().nullable().optional(),
    /** Defaults to the creator. Employees can only book themselves. */
    staffId: z.string().uuid().nullable().optional(),
    leadId: z.string().uuid().optional(),
    customer: z
      .object({
        name: z
          .string({ required_error: appointmentMessages.customerNameRequired })
          .trim()
          .min(2, appointmentMessages.customerNameRequired)
          .max(80),
        phone: phoneSchema,
      })
      .optional(),
    notes,
  })
  .refine((v) => v.leadId || v.customer, {
    message: appointmentMessages.customerRequired,
    path: ['leadId'],
  });
export type CreateAppointmentRequest = z.input<typeof createAppointmentRequestSchema>;

export const updateAppointmentRequestSchema = z.object({
  startsAt: startsAt.optional(),
  durationMin: duration.optional(),
  serviceId: z.string().uuid().nullable().optional(),
  staffId: z.string().uuid().nullable().optional(),
  status: z.enum(APPOINTMENT_STATUSES).optional(),
  notes: notes.optional(),
});
export type UpdateAppointmentRequest = z.input<typeof updateAppointmentRequestSchema>;

/** GET /appointments: a time window (max 62 days), plus filters. */
export const appointmentListQuerySchema = z
  .object({
    from: z.string().datetime(),
    to: z.string().datetime(),
    staffId: z.union([z.literal('me'), z.string().uuid()]).optional(),
    leadId: z.string().uuid().optional(),
    status: z.enum(APPOINTMENT_STATUSES).optional(),
  })
  .refine((q) => {
    const span = new Date(q.to).getTime() - new Date(q.from).getTime();
    return span > 0 && span <= 62 * 86_400_000;
  }, 'טווח לא תקין');
export type AppointmentListQuery = z.input<typeof appointmentListQuerySchema>;

export const appointmentResponseSchema = z.object({ appointment: appointmentSchema });
export type AppointmentResponse = z.infer<typeof appointmentResponseSchema>;
export const appointmentListResponseSchema = z.object({
  appointments: z.array(appointmentSchema),
});
export type AppointmentListResponse = z.infer<typeof appointmentListResponseSchema>;

export const appointmentsApiPaths = {
  services: (businessId: string) => `/api/v1/businesses/${businessId}/services`,
  service: (businessId: string, id: string) => `/api/v1/businesses/${businessId}/services/${id}`,
  list: (businessId: string) => `/api/v1/businesses/${businessId}/appointments`,
  appointment: (businessId: string, id: string) =>
    `/api/v1/businesses/${businessId}/appointments/${id}`,
  /** Pending website requests, regardless of date. */
  requests: (businessId: string) => `/api/v1/businesses/${businessId}/appointments/requests`,
} as const;

/** Two time ranges overlap (touching ends don't). */
export const overlaps = (aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) =>
  aStart < bEnd && bStart < aEnd;
