import type { PrismaClient } from '@prisma/client';
import { LEAD_SOURCES, type ReportSummary } from '@leadflow/shared';
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

  async summary(ctx: TenantContext, days: number, now = new Date()): Promise<ReportSummary> {
    const to = now;
    const from = new Date(to.getTime() - days * DAY);
    const prevFrom = new Date(from.getTime() - days * DAY);
    const business = await this.prisma.business.findUniqueOrThrow({
      where: { id: ctx.businessId },
      select: { timezone: true },
    });
    const stages = await ensureStages(this.prisma, ctx.businessId);
    const [leads, previous] = await Promise.all([
      this.prisma.lead.findMany({
        where: { businessId: ctx.businessId, createdAt: { gte: from, lt: to } },
        select: { id: true, createdAt: true, source: true, stageId: true, expectedValue: true },
      }),
      this.prisma.lead.count({
        where: { businessId: ctx.businessId, createdAt: { gte: prevFrom, lt: from } },
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
      byStage,
      bySource,
    };
  }
}
