import { z } from 'zod';
import { attributionSchema } from './attribution';
import { APPOINTMENT_STATUSES } from './appointments';

/**
 * Customers page (D-163, D-178): people who bought — a lead in a Won stage or with an accepted
 * quote, the same rule as Reports (F26) — and people who booked: an appointment that is confirmed,
 * done, missed or cancelled (a request still waiting for approval isn't one yet). One row per
 * contact, with each purchase and each booking.
 */
export const customerPurchaseSchema = z.object({
  leadId: z.string().uuid(),
  /** When it became a purchase: the quote's acceptance, else the lead's last change. */
  at: z.string().datetime(),
  /** Deal value in whole units; null when none was entered. */
  value: z.number().int().nullable(),
  /** `won` = moved to a Won stage, `quote` = accepted a quote (both = won). */
  via: z.enum(['won', 'quote']),
});

/** A booking: an appointment in a status other than "waiting for approval". */
export const CUSTOMER_BOOKING_STATUSES = APPOINTMENT_STATUSES.filter((s) => s !== 'REQUESTED');
export const customerBookingSchema = z.object({
  appointmentId: z.string().uuid(),
  startsAt: z.string().datetime(),
  status: z.enum(APPOINTMENT_STATUSES),
  serviceName: z.string().nullable(),
  leadId: z.string().uuid().nullable(),
});

export const customerSchema = z.object({
  contactId: z.string().uuid(),
  name: z.string(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  totalValue: z.number().int(),
  /** Null for someone who only booked. */
  lastPurchaseAt: z.string().datetime().nullable(),
  /** The latest purchase or booking, for ordering. */
  lastActivityAt: z.string().datetime(),
  /** Where they first came from (their first purchase's lead); null = unknown. */
  attribution: attributionSchema.nullable(),
  /** Newest first. */
  purchases: z.array(customerPurchaseSchema),
  /** Newest first. */
  bookings: z.array(customerBookingSchema),
});
export type Customer = z.infer<typeof customerSchema>;

export const customerListQuerySchema = z.object({ q: z.string().trim().max(100).optional() });
export const customerListResponseSchema = z.object({ customers: z.array(customerSchema) });
export type CustomerListResponse = z.infer<typeof customerListResponseSchema>;

export const customersApiPaths = {
  list: (businessId: string) => `/api/v1/businesses/${businessId}/customers`,
} as const;
