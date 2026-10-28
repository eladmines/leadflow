import { z } from 'zod';
import { LEAD_SOURCES, STAGE_KINDS } from './leads';

/** F20 (lite) — basic reports from real CRM data (PRD §10). */
export const REPORT_RANGES = [7, 30, 90] as const;

export const reportQuerySchema = z.object({
  days: z.coerce
    .number()
    .refine((d) => (REPORT_RANGES as readonly number[]).includes(d))
    .default(30),
});
export type ReportQuery = z.input<typeof reportQuerySchema>;

export const reportSummarySchema = z.object({
  range: z.object({
    from: z.string().datetime(),
    to: z.string().datetime(),
    days: z.number().int(),
  }),
  /** Leads created in the range, and in the previous range of the same length. */
  leads: z.object({ current: z.number().int(), previous: z.number().int() }),
  /** Won / (won + lost) for leads created in the range; null when nothing was decided yet. */
  closeRate: z.number().nullable(),
  wonValue: z.number().int(),
  openValue: z.number().int(),
  /** Average minutes from a lead arriving to the first human action on it (note, stage, assignment). */
  avgResponseMinutes: z.number().nullable(),
  respondedLeads: z.number().int(),
  /** Daily buckets for ≤ 31 days, weekly (week starting Sunday) beyond; dates are local to the business. */
  series: z.object({
    unit: z.enum(['day', 'week']),
    points: z.array(z.object({ date: z.string(), count: z.number().int() })),
  }),
  byStage: z.array(
    z.object({
      id: z.string().uuid(),
      name: z.string(),
      kind: z.enum(STAGE_KINDS),
      count: z.number().int(),
      value: z.number().int(),
    }),
  ),
  bySource: z.array(z.object({ source: z.enum(LEAD_SOURCES), count: z.number().int() })),
});
export type ReportSummary = z.infer<typeof reportSummarySchema>;

export const reportsApiPaths = {
  summary: (businessId: string) => `/api/v1/businesses/${businessId}/reports/summary`,
} as const;
