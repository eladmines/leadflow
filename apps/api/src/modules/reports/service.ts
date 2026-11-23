import type { PrismaClient } from '@prisma/client';
import {
  attributionName,
  attributionSchema,
  LEAD_SOURCES,
  normalizePagePath,
  type AttributionReportRow,
  type Behavior,
  type ReportSummary,
} from '@simplecatch/shared';
import type { TenantContext } from '../../plugins/tenant';
import { ensureStages } from '../leads/service';

const DAY = 86_400_000;

/** `YYYY-MM-DD` of an instant in a time zone. */
const localDate = (tz: string) => {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return (d: Date) => fmt.format(d);
};

/** 0-23: the hour of an instant in a time zone. */
const localHour = (tz: string) => {
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' });
  return (d: Date) => Number(fmt.format(d)) % 24;
};

/** The calendar day after a `YYYY-MM-DD`. */
const nextDay = (ymd: string) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

/** Sunday-start week key for a local `YYYY-MM-DD`. */
const weekStart = (ymd: string) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0, 10);
};

export class ReportService {
  constructor(private readonly prisma: PrismaClient) {}

  /** F32: what visitors do on a website with the script (counts per kind and label). */
  private behavior(
    rows: { kind: string; label: string; count: number }[],
    leads: { attribution: unknown }[],
  ): Behavior {
    const sum = (kind: string, label?: string) =>
      rows
        .filter((r) => r.kind === kind && (label === undefined || r.label === label))
        .reduce((a, r) => a + r.count, 0);
    const by = (kind: string) => {
      const m = new Map<string, number>();
      for (const r of rows) if (r.kind === kind) m.set(r.label, (m.get(r.label) ?? 0) + r.count);
      return m;
    };
    const leadsByLanding = new Map<string, number>();
    for (const l of leads) {
      const a = attributionSchema.safeParse(l.attribution);
      if (a.success && a.data.landingPath) {
        const path = normalizePagePath(a.data.landingPath);
        leadsByLanding.set(path, (leadsByLanding.get(path) ?? 0) + 1);
      }
    }
    const landings = by('landing');
    // A landing page with inquiries but no counted visits (a site without the script) isn't shown.
    return {
      pageViews: sum('page'),
      topPages: [...by('page')]
        .map(([path, views]) => ({ path, views }))
        .sort((a, b) => b.views - a.views)
        .slice(0, 10),
      landing: [...landings]
        .map(([path, visits]) => ({ path, visits, leads: leadsByLanding.get(path) ?? 0 }))
        .sort((a, b) => b.visits - a.visits)
        .slice(0, 10),
      devices: {
        mobile: sum('device', 'mobile'),
        tablet: sum('device', 'tablet'),
        desktop: sum('device', 'desktop'),
      },
      clicks: {
        phone: sum('click', 'phone'),
        whatsapp: sum('click', 'whatsapp'),
        email: sum('click', 'email'),
      },
      scroll: { p50: sum('scroll', '50'), p90: sum('scroll', '90') },
      ctas: [...by('cta')]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
      formStarts: sum('form', 'start'),
    };
  }

  async summary(ctx: TenantContext, days: number, now = new Date()): Promise<ReportSummary> {
    const to = now;
    const from = new Date(to.getTime() - days * DAY);
    const prevFrom = new Date(from.getTime() - days * DAY);
    const business = await this.prisma.business.findUniqueOrThrow({
      where: { id: ctx.businessId },
      select: { timezone: true },
    });
    const stages = await ensureStages(this.prisma, ctx.businessId);
    const toLocalDay = localDate(business.timezone);
    const [leads, previous, visitRows, eventRows] = await Promise.all([
      this.prisma.lead.findMany({
        where: { businessId: ctx.businessId, createdAt: { gte: from, lt: to } },
        select: {
          id: true,
          createdAt: true,
          source: true,
          stageId: true,
          expectedValue: true,
          attribution: true,
          quotes: { where: { status: 'ACCEPTED' }, select: { id: true }, take: 1 },
        },
      }),
      this.prisma.lead.count({
        where: { businessId: ctx.businessId, createdAt: { gte: prevFrom, lt: from } },
      }),
      this.prisma.visitCount.findMany({
        where: {
          businessId: ctx.businessId,
          day: { gte: toLocalDay(from), lte: toLocalDay(to) },
        },
        select: { source: true, name: true, campaign: true, count: true },
      }),
      this.prisma.eventCount.findMany({
        where: {
          businessId: ctx.businessId,
          day: { gte: toLocalDay(from), lte: toLocalDay(to) },
        },
        select: { kind: true, label: true, count: true },
      }),
    ]);

    // Stages and money.
    const kindOf = new Map(stages.map((s) => [s.id, s.kind]));
    const byStage = stages.map((s) => {
      const inStage = leads.filter((l) => l.stageId === s.id);
      return {
        id: s.id,
        name: s.name,
        kind: s.kind,
        count: inStage.length,
        value: inStage.reduce((sum, l) => sum + (l.expectedValue ?? 0), 0),
      };
    });
    const won = leads.filter((l) => kindOf.get(l.stageId) === 'WON');
    const lost = leads.filter((l) => kindOf.get(l.stageId) === 'LOST');
    const sumValue = (xs: typeof leads) => xs.reduce((sum, l) => sum + (l.expectedValue ?? 0), 0);

    // Sources (every source listed, even at zero).
    const bySource = LEAD_SOURCES.map((source) => ({
      source,
      count: leads.filter((l) => l.source === source).length,
    }));

    // F26: where customers come from. A customer = a Won stage or an accepted quote.
    const isCustomer = (l: (typeof leads)[number]) =>
      kindOf.get(l.stageId) === 'WON' || l.quotes.length > 0;
    const rows = new Map<string, AttributionReportRow>();
    const campaigns = new Map<string, AttributionReportRow & { campaign: string }>();
    const add = (row: AttributionReportRow, l: (typeof leads)[number]) => {
      row.leads += 1;
      if (isCustomer(l)) {
        row.won += 1;
        row.wonValue += l.expectedValue ?? 0;
      } else if (kindOf.get(l.stageId) === 'LOST') row.lost += 1;
    };
    const empty = (source: AttributionReportRow['source'], name: string | null) => ({
      source,
      name,
      leads: 0,
      won: 0,
      lost: 0,
      wonValue: 0,
      visits: 0,
    });
    for (const l of leads) {
      const a = attributionSchema.safeParse(l.attribution);
      const source = a.success && a.data.source !== 'direct' ? a.data.source : 'unknown';
      const name =
        a.success && (source === 'utm' || source === 'referral') ? attributionName(a.data) : null;
      const key = `${source}|${name ?? ''}`;
      if (!rows.has(key)) rows.set(key, empty(source, name));
      add(rows.get(key)!, l);
      const campaign = a.success ? (a.data.campaign ?? a.data.adHeadline) : undefined;
      if (campaign) {
        const ck = `${key}|${campaign}`;
        if (!campaigns.has(ck)) campaigns.set(ck, { ...empty(source, name), campaign });
        add(campaigns.get(ck)!, l);
      }
    }
    // F31: visits join the same rows. An unknown source on a lead is a direct visit.
    let visits = 0;
    for (const v of visitRows) {
      visits += v.count;
      const source = (
        v.source === 'direct' ? 'unknown' : v.source
      ) as AttributionReportRow['source'];
      const name = v.name || null;
      const key = `${source}|${name ?? ''}`;
      if (!rows.has(key)) rows.set(key, empty(source, name));
      rows.get(key)!.visits += v.count;
      if (v.campaign) {
        const ck = `${key}|${v.campaign}`;
        if (!campaigns.has(ck)) campaigns.set(ck, { ...empty(source, name), campaign: v.campaign });
        campaigns.get(ck)!.visits += v.count;
      }
    }
    const behavior = this.behavior(eventRows, leads);
    const byLeads = (a: AttributionReportRow, b: AttributionReportRow) =>
      b.won - a.won || b.leads - a.leads || b.visits - a.visits;

    // Time series in the business's local days.
    const toLocal = localDate(business.timezone);
    const unit = days <= 31 ? ('day' as const) : ('week' as const);
    // Every local day from the range start to today, inclusive (so the first partial day has a bucket).
    const keys: string[] = [];
    const last = toLocal(to);
    for (let day = toLocal(from); day <= last; day = nextDay(day)) {
      const key = unit === 'day' ? day : weekStart(day);
      if (keys.at(-1) !== key) keys.push(key);
    }
    const counts = new Map(keys.map((k) => [k, 0]));
    for (const l of leads) {
      const day = toLocal(l.createdAt);
      const key = unit === 'day' ? day : weekStart(day);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    // When inquiries arrive: per local hour of the day.
    const hourOf = localHour(business.timezone);
    const byHour = Array.from({ length: 24 }, () => 0);
    for (const l of leads) {
      const h = hourOf(l.createdAt);
      byHour[h] = (byHour[h] ?? 0) + 1;
    }

    // Response time: first human action per lead (lead.created is not a response).
    const firstActions = leads.length
      ? await this.prisma.activity.findMany({
          where: {
            businessId: ctx.businessId,
            leadId: { in: leads.map((l) => l.id) },
            actorId: { not: null },
            type: { not: 'lead.created' },
          },
          select: { leadId: true, createdAt: true },
          orderBy: { createdAt: 'asc' },
        })
      : [];
    const firstByLead = new Map<string, Date>();
    for (const a of firstActions)
      if (!firstByLead.has(a.leadId)) firstByLead.set(a.leadId, a.createdAt);
    const minutes = leads
      .filter((l) => firstByLead.has(l.id))
      .map((l) => (firstByLead.get(l.id)!.getTime() - l.createdAt.getTime()) / 60_000);

    return {
      range: { from: from.toISOString(), to: to.toISOString(), days },
      leads: { current: leads.length, previous },
      closeRate: won.length + lost.length > 0 ? won.length / (won.length + lost.length) : null,
      wonValue: sumValue(won),
      openValue: sumValue(leads.filter((l) => kindOf.get(l.stageId) === 'OPEN')),
      avgResponseMinutes: minutes.length
        ? Math.round(minutes.reduce((a, b) => a + b, 0) / minutes.length)
        : null,
      respondedLeads: minutes.length,
      series: { unit, points: [...counts].map(([date, count]) => ({ date, count })) },
      byHour,
      byStage,
      bySource,
      byAttribution: [...rows.values()].sort(byLeads),
      visits,
      behavior,
      byCampaign: [...campaigns.values()].sort(byLeads).slice(0, 10),
    };
  }
}
