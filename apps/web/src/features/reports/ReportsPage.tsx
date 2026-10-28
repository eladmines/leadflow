import { can, leadSourceLabels, REPORT_RANGES, type ReportSummary } from '@leadflow/shared';
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

const rangeLabels: Record<number, string> = { 7: '7 ימים', 30: '30 יום', 90: '90 יום' };

/** F20 (lite): headline numbers, leads over time, the pipeline funnel and sources. */
export function ReportsPage() {
  const business = useCurrentBusiness();
  if (!can(business.role, 'reports.view')) return <NoPermission what="דוחות" />;
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
        title="דוחות"
        description="איך העסק עובד עם הפניות: כמה מגיעות, מאיפה, כמה מהר עונים ומה נסגר."
        actions={
          <div role="group" aria-label="טווח זמן" className="flex rounded-xl bg-surface-sunken p-1">
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
        <Spinner label="טוענים דוחות…" />
      ) : report.isError ? (
        <Alert tone="danger">{errorMessage(report.error)}</Alert>
      ) : (
        <ReportBody r={report.data} />
      )}
    </>
  );
}

function ReportBody({ r }: { r: ReportSummary }) {
  const delta = r.leads.current - r.leads.previous;
  const decided = r.byStage.filter((s) => s.kind !== 'OPEN').reduce((a, s) => a + s.count, 0);
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="פניות חדשות"
          value={String(r.leads.current)}
          note={
            delta === 0
              ? 'כמו בתקופה הקודמת'
              : `${delta > 0 ? '+' : '−'}${Math.abs(delta)} לעומת התקופה הקודמת`
          }
        />
        <StatTile
          label="יחס סגירה"
          value={r.closeRate === null ? '—' : `${Math.round(r.closeRate * 100)}%`}
          note={r.closeRate === null ? 'עדיין אין פניות שנסגרו או אבדו' : `מתוך ${decided} שהוכרעו`}
        />
        <StatTile
          label="עסקאות שנסגרו"
          value={shekel.format(r.wonValue)}
          note={`${shekel.format(r.openValue)} עוד פתוחים`}
        />
        <StatTile
          label="זמן תגובה ממוצע"
          value={r.avgResponseMinutes === null ? '—' : durationLabel(r.avgResponseMinutes)}
          note={
            r.avgResponseMinutes === null
              ? 'עוד לא טיפלו באף פנייה'
              : `לפי ${r.respondedLeads} פניות שטופלו`
          }
        />
      </div>
      <LeadsOverTime series={r.series} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold text-ink">פניות לפי שלב</h2>
          <HBars
            label="פניות לפי שלב"
            rows={r.byStage.map((s) => ({
              key: s.id,
              name: s.name,
              count: s.count,
              extra: s.value ? shekel.format(s.value) : undefined,
            }))}
          />
        </Card>
        <Card className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold text-ink">מאיפה הגיעו הפניות</h2>
          <HBars
            label="פניות לפי מקור"
            rows={r.bySource.map((s) => ({
              key: s.source,
              name: leadSourceLabels[s.source],
              count: s.count,
            }))}
          />
        </Card>
      </div>
    </>
  );
}

function StatTile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <Card className="flex flex-col gap-1">
      <span className="text-sm text-ink-muted">{label}</span>
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
    series.unit === 'week' ? `שבוע מ־${shortDate(d)}` : shortDate(d);
  const tickEvery = Math.ceil(series.points.length / 8);

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-ink">
          פניות לאורך זמן{' '}
          <span className="text-sm font-normal text-ink-muted">
            ({series.unit === 'week' ? 'לפי שבוע' : 'לפי יום'})
          </span>
        </h2>
        <button
          type="button"
          onClick={() => setAsTable((v) => !v)}
          className="text-sm text-brand-600 underline-offset-2 hover:underline"
        >
          {asTable ? 'הצגה כגרף' : 'הצגה כטבלה'}
        </button>
      </div>
      {asTable ? (
        <div className="max-h-80 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="text-ink-muted">
              <tr>
                <th className="py-1 text-start font-medium">
                  {series.unit === 'week' ? 'שבוע' : 'יום'}
                </th>
                <th className="py-1 text-end font-medium">פניות</th>
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
            aria-label="פניות לאורך זמן"
            className="flex h-44 items-end gap-0.5 border-b border-chart-grid"
          >
            {series.points.map((p) => (
              <div
                key={p.date}
                role="listitem"
                tabIndex={0}
                aria-label={`${dateLabel(p.date)}: ${p.count} פניות`}
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
                  {dateLabel(p.date)} · {p.count} פניות
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
          <p className="mt-1 text-xs text-ink-muted">שיא: {max} פניות</p>
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
  rows: { key: string; name: string; count: number; extra?: string }[];
}) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <ul aria-label={label} className="flex flex-col gap-3">
      {rows.map((r) => (
        <li key={r.key} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="text-ink">{r.name}</span>
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
