import { can, leadSourceLabels, REPORT_RANGES, type ReportSummary } from '@leadflow/shared';
import { Coins, Target, Timer, Users, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Alert, Card, Spinner } from '../../components/ui';
import { cn } from '../../lib/cn';
import { errorMessage } from '../auth/serverErrors';
import { shekel } from '../leads/api';
import { useCurrentBusiness } from '../shell/CurrentBusiness';
import { NoPermission } from '../shell/NoPermission';
import { PageHeader } from '../shell/PageHeader';
import { durationLabel, shortDate, useReportSummary } from './api';
import { CustomerSources } from './CustomerSources';
import { LeadSourceIcon } from '../leads/SourceIcon';
import { tr } from '../../i18n';

const rangeLabels: Record<number, string> = { 7: tr('7 ימים'), 30: tr('30 יום'), 90: tr('90 יום') };

/** F20 (lite): headline numbers, leads over time, the pipeline funnel and sources. */
export function ReportsPage() {
  const business = useCurrentBusiness();
  if (!can(business.role, 'reports.view')) return <NoPermission what={tr('דוחות')} />;
  return <Reports businessId={business.id} />;
}

function Reports({ businessId }: { businessId: string }) {
  const [params, setParams] = useSearchParams();
  const asked = Number(params.get('days'));
  const days = (REPORT_RANGES as readonly number[]).includes(asked) ? asked : 30;
  const report = useReportSummary(businessId, days);

  return (
    <>
      <PageHeader
        title={tr('דוחות')}
        description={tr('איך העסק עובד עם הפניות: כמה מגיעות, מאיפה, כמה מהר עונים ומה נסגר.')}
        actions={
          <div
            role="group"
            aria-label={tr('טווח זמן')}
            className="flex rounded-xl bg-surface-sunken p-1"
          >
            {REPORT_RANGES.map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={days === d}
                onClick={() => setParams(d === 30 ? {} : { days: String(d) }, { replace: true })}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-sm',
                  days === d ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted',
                )}
              >
                {rangeLabels[d]}
              </button>
            ))}
          </div>
        }
      />
      {report.isPending ? (
        <Spinner label={tr('טוענים דוחות…')} />
      ) : report.isError ? (
        <Alert tone="danger">{errorMessage(report.error)}</Alert>
      ) : (
        <ReportBody r={report.data} businessId={businessId} />
      )}
    </>
  );
}

function ReportBody({ r, businessId }: { r: ReportSummary; businessId: string }) {
  const delta = r.leads.current - r.leads.previous;
  const decided = r.byStage.filter((s) => s.kind !== 'OPEN').reduce((a, s) => a + s.count, 0);
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          icon={Users}
          tone="bg-violet-500"
          label={tr('פניות חדשות')}
          value={String(r.leads.current)}
          note={
            delta === 0
              ? tr('כמו בתקופה הקודמת')
              : tr('{0}{1} לעומת התקופה הקודמת', delta > 0 ? '+' : '−', Math.abs(delta))
          }
        />
        <StatTile
          icon={Target}
          tone="bg-emerald-500"
          label={tr('יחס סגירה')}
          value={r.closeRate === null ? '—' : `${Math.round(r.closeRate * 100)}%`}
          note={
            r.closeRate === null
              ? tr('עדיין אין פניות שנסגרו או אבדו')
              : tr('מתוך {0} שהוכרעו', decided)
          }
        />
        <StatTile
          icon={Coins}
          tone="bg-amber-500"
          label={tr('עסקאות שנסגרו')}
          value={shekel.format(r.wonValue)}
          note={tr('{0} עוד פתוחים', shekel.format(r.openValue))}
        />
        <StatTile
          icon={Timer}
          tone="bg-sky-500"
          label={tr('זמן תגובה ממוצע')}
          value={r.avgResponseMinutes === null ? '—' : durationLabel(r.avgResponseMinutes)}
          note={
            r.avgResponseMinutes === null
              ? tr('עוד לא טיפלו באף פנייה')
              : tr('לפי {0} פניות שטופלו', r.respondedLeads)
          }
        />
      </div>
      <LeadsOverTime series={r.series} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold text-ink">{tr('פניות לפי שלב')}</h2>
          <HBars
            label={tr('פניות לפי שלב')}
            rows={r.byStage.map((s) => ({
              key: s.id,
              name: tr(s.name),
              count: s.count,
              extra: s.value ? shekel.format(s.value) : undefined,
            }))}
          />
        </Card>
        <Card className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold text-ink">{tr('מאיפה הגיעו הפניות')}</h2>
          <HBars
            label={tr('פניות לפי מקור')}
            rows={r.bySource.map((s) => ({
              key: s.source,
              name: tr(leadSourceLabels[s.source]),
              icon: <LeadSourceIcon source={s.source} />,
              count: s.count,
            }))}
          />
        </Card>
      </div>
      <CustomerSources businessId={businessId} report={r} />
    </>
  );
}

function StatTile({
  label,
  value,
  note,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  note: string;
  icon: LucideIcon;
  /** The icon tile's colour (D-141). */
  tone: string;
}) {
  return (
    <Card className="flex flex-col gap-1">
      <span className="flex items-center gap-2 text-sm text-ink-muted">
        <span
          aria-hidden
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-lg text-white shadow-sm',
            tone,
          )}
        >
          <Icon className="h-4 w-4" />
        </span>
        {label}
      </span>
      <span className="text-2xl font-semibold tabular-nums text-ink sm:text-3xl">
        <bdi>{value}</bdi>
      </span>
      <span className="text-xs text-ink-muted">{note}</span>
    </Card>
  );
}

/** Single-series column chart (no legend: the title names it), with a table view. */
function LeadsOverTime({ series }: { series: ReportSummary['series'] }) {
  const [asTable, setAsTable] = useState(false);
  const max = Math.max(1, ...series.points.map((p) => p.count));
  const dateLabel = (d: string) =>
    series.unit === 'week' ? tr('שבוע מ־{0}', shortDate(d)) : shortDate(d);
  const tickEvery = Math.ceil(series.points.length / 8);

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-ink">
          {tr('פניות לאורך זמן')}{' '}
          <span className="text-sm font-normal text-ink-muted">
            ({series.unit === 'week' ? tr('לפי שבוע') : tr('לפי יום')})
          </span>
        </h2>
        <button
          type="button"
          onClick={() => setAsTable((v) => !v)}
          className="text-sm text-brand-600 underline-offset-2 hover:underline"
        >
          {asTable ? tr('הצגה כגרף') : tr('הצגה כטבלה')}
        </button>
      </div>
      {asTable ? (
        <div className="scrollbar-visible max-h-80 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="text-ink-muted">
              <tr>
                <th className="py-1 text-start font-medium">
                  {series.unit === 'week' ? tr('שבוע') : tr('יום')}
                </th>
                <th className="py-1 text-end font-medium">{tr('פניות')}</th>
              </tr>
            </thead>
            <tbody>
              {series.points.map((p) => (
                <tr key={p.date} className="border-t border-surface-border">
                  <td className="py-1 text-ink">{dateLabel(p.date)}</td>
                  <td className="py-1 text-end tabular-nums text-ink">{p.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div>
          <div
            role="list"
            aria-label={tr('פניות לאורך זמן')}
            className="flex h-44 items-end gap-0.5 border-b border-chart-grid"
          >
            {series.points.map((p) => (
              <div
                key={p.date}
                role="listitem"
                tabIndex={0}
                aria-label={tr('{0}: {1} פניות', dateLabel(p.date), p.count)}
                className="group relative flex h-full flex-1 items-end justify-center rounded-sm outline-none hover:bg-chart-soft focus-visible:bg-chart-soft focus-visible:ring-2 focus-visible:ring-brand-400"
              >
                <div
                  className="w-full max-w-[24px] rounded-t bg-chart"
                  style={{ height: p.count ? `${(p.count / max) * 100}%` : 0 }}
                />
                <div
                  aria-hidden
                  className="pointer-events-none absolute bottom-full z-10 mb-1 hidden whitespace-nowrap rounded-lg bg-ink px-2 py-1 text-xs text-white shadow-lift group-hover:block group-focus-visible:block"
                >
                  {dateLabel(p.date)} · {p.count} {tr('פניות')}
                </div>
              </div>
            ))}
          </div>
          <div aria-hidden className="mt-1 flex gap-0.5 text-[11px] text-ink-muted">
            {series.points.map((p, i) => (
              <span key={p.date} className="flex-1 text-center">
                {i % tickEvery === 0 ? shortDate(p.date) : ''}
              </span>
            ))}
          </div>
          <p className="mt-1 text-xs text-ink-muted">
            {tr('שיא:')} {max} {tr('פניות')}
          </p>
        </div>
      )}
    </Card>
  );
}

/** Horizontal bars for a small category breakdown; values are written out, so no table is needed. */
function HBars({
  label,
  rows,
}: {
  label: string;
  rows: { key: string; name: string; icon?: React.ReactNode; count: number; extra?: string }[];
}) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <ul aria-label={label} className="flex flex-col gap-3">
      {rows.map((r) => (
        <li key={r.key} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="flex items-center gap-2 text-ink">
              {r.icon}
              {r.name}
            </span>
            <span className="tabular-nums text-ink-muted">
              {r.count}
              {r.extra && (
                <>
                  {' '}
                  · <bdi>{r.extra}</bdi>
                </>
              )}
            </span>
          </div>
          <div className="h-3 rounded bg-surface-sunken">
            <div
              className="h-full rounded bg-chart"
              style={{ width: r.count ? `max(4px, ${(r.count / max) * 100}%)` : 0 }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
