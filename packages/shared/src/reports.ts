import { z } from 'zod';
import { LEAD_SOURCES, STAGE_KINDS } from './leads';
import { ATTRIBUTION_SOURCES } from './attribution';

/** F20 (lite) — basic reports from real CRM data (PRD §10). */
export const REPORT_RANGES = [7, 30, 90] as const;

export const reportQuerySchema = z.object({
  days: z.coerce
    .number()
    .refine((d) => (REPORT_RANGES as readonly number[]).includes(d))
    .default(30),
});
const attributionRow = z.object({
  source: z.enum([...ATTRIBUTION_SOURCES, 'unknown']),
  /** utm_source / referring host when the source is `utm` / `referral`. */
  name: z.string().nullable(),
  leads: z.number().int(),
  /** Leads in a Won stage ("became customers"). */
  won: z.number().int(),
  lost: z.number().int(),
  /** Sum of the won leads' deal values (whole units). */
  wonValue: z.number().int(),
  /** F31: website visits from this source (or campaign) in the range. */
  visits: z.number().int(),
});
export type AttributionReportRow = z.infer<typeof attributionRow>;

/** F32: what visitors do on a website with the script (counts, never people). */
export const behaviorSchema = z.object({
  /** Pages opened, and by the most-opened pages. */
  pageViews: z.number().int(),
  topPages: z.array(z.object({ path: z.string(), views: z.number().int() })),
  /** The entry page of each session, with the inquiries that came from visits starting there. */
  landing: z.array(
    z.object({ path: z.string(), visits: z.number().int(), leads: z.number().int() }),
  ),
  devices: z.object({
    mobile: z.number().int(),
    tablet: z.number().int(),
    desktop: z.number().int(),
  }),
  clicks: z.object({
    phone: z.number().int(),
    whatsapp: z.number().int(),
    email: z.number().int(),
  }),
  /** Page views that reached half the page, and 90% of it. */
  scroll: z.object({ p50: z.number().int(), p90: z.number().int() }),
  /** Sections that were on screen, per page (most seen first); `name` is a section type or a name the owner gave. */
  sections: z.array(
    z.object({
      path: z.string(),
      name: z.string(),
      views: z.number().int(),
      /** Views of that page, to read `views` as a share. */
      pageViews: z.number().int(),
    }),
  ),
  /** Buttons the owner chose to count (`data-sc-click` / `data-track`), most clicked first. */
  ctas: z.array(z.object({ name: z.string(), count: z.number().int() })),
  /** Forms started (a first field filled). Sent ones are the website leads. */
  formStarts: z.number().int(),
});
export type Behavior = z.infer<typeof behaviorSchema>;

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
  /** Leads created in the range per local hour of the day (index 0-23, in the business's time zone). */
  byHour: z.array(z.number().int()).length(24),
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
  /** F26: where customers come from, per source and per campaign (leads created in the range). */
  byAttribution: z.array(attributionRow),
  /** F31: all website visits in the range (SimpleCatch sites and the embed script). */
  visits: z.number().int(),
  /** F32: what visitors do on a website with the script. */
  behavior: behaviorSchema,
  byCampaign: z.array(attributionRow.extend({ campaign: z.string() })),
});
export type ReportSummary = z.infer<typeof reportSummarySchema>;

export const reportsApiPaths = {
  summary: (businessId: string) => `/api/v1/businesses/${businessId}/reports/summary`,
} as const;
