import { z } from 'zod';
import { attributionSchema } from './attribution';

/**
 * Customers page (D-163): people who bought — a lead in a Won stage or with an accepted quote, the
 * same rule as Reports (F26). One row per contact, with each purchase.
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

export const customerSchema = z.object({
  contactId: z.string().uuid(),
  name: z.string(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  totalValue: z.number().int(),
  lastPurchaseAt: z.string().datetime(),
  /** Where they first came from (their first purchase's lead); null = unknown. */
  attribution: attributionSchema.nullable(),
  /** Newest first. */
  purchases: z.array(customerPurchaseSchema),
});
export type Customer = z.infer<typeof customerSchema>;

export const customerListQuerySchema = z.object({ q: z.string().trim().max(100).optional() });
export const customerListResponseSchema = z.object({ customers: z.array(customerSchema) });
export type CustomerListResponse = z.infer<typeof customerListResponseSchema>;

export const customersApiPaths = {
  list: (businessId: string) => `/api/v1/businesses/${businessId}/customers`,
} as const;
