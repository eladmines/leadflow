import { businessWebPaths, can, leadSourceLabels, type ReportSummary } from '@leadflow/shared';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Alert, Spinner } from '../../components/ui';
import { errorMessage } from '../auth/serverErrors';
import { LeadSourceIcon } from '../leads/SourceIcon';
import { durationLabel, useReportSummary } from '../reports/api';
import { useCurrentBusiness } from '../shell/CurrentBusiness';
import { tr } from '../../i18n';

const DAYS = 7;

/**
 * The dashboard's leads picture: this week's new leads against last week, where they came from,
 * and how they move through the stages. Numbers come from the reports summary, so owners and
 * managers only (`reports.view`).
 */
export function LeadsOverview() {
  const business = useCurrentBusiness();
  const allowed = can(business.role, 'reports.view');
  const report = useReportSummary(business.id, DAYS, allowed);
  if (!allowed) return null;

  return (
    <section aria-labelledby="overview-title" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="overview-title" className="text-lg font-semibold text-ink">
          {tr('הפניות ב-7 הימים האחרונים')}
        </h2>
        <Link
          to={businessWebPaths.section(business.id, 'reports')}
          className="text-sm font-medium text-brand-700 hover:underline"
        >
          {tr('לכל הדוחות')}
        </Link>
      </div>
      {report.isPending ? (
        <Spinner label={tr('טוענים…')} />
      ) : report.isError ? (
        <Alert tone="danger">{errorMessage(report.error)}</Alert>
      ) : (
        <div className="grid gap-3 lg:grid-cols-3">
          <NewLeads report={report.data} />
          <Sources report={report.data} />
          <Funnel report={report.data} businessId={business.id} />
        </div>
      )}
    </section>
  );
}

const card =
  'flex flex-col gap-3 rounded-2xl border border-surface-border bg-surface p-4 shadow-card';

function NewLeads({ report }: { report: ReportSummary }) {
  const { current, previous } = report.leads;
  const diff = current - previous;
  const Icon = diff > 0 ? ArrowUpRight : diff < 0 ? ArrowDownRight : Minus;
  const points = report.series.points;
  const max = Math.max(1, ...points.map((p) => p.count));
  const step = points.length > 1 ? 100 / (points.length - 1) : 0;
  const line = points.map((p, i) => `${i * step},${28 - (p.count / max) * 26}`).join(' ');
  return (
    <div className={card}>
      <h3 className="text-sm font-medium text-ink-muted">{tr('פניות חדשות')}</h3>
      <p className="flex items-baseline gap-2">
        <span className="text-3xl font-semibold tabular-nums text-ink">{current}</span>
        <span className="inline-flex items-center gap-0.5 text-sm text-ink-muted">
          <Icon aria-hidden className="h-4 w-4" />
          {diff === 0
            ? tr('כמו בשבוע שעבר')
            : tr('{0} לעומת השבוע שעבר', `${diff > 0 ? '+' : '−'}${Math.abs(diff)}`)}
        </span>
      </p>
      {/* Time runs left to right in either language. */}
      <div dir="ltr">
        <svg
          viewBox="0 0 100 30"
          preserveAspectRatio="none"
          role="img"
          aria-label={tr('פניות חדשות לפי יום')}
          className="h-12 w-full text-brand-600"
        >
          <polyline
            points={line}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>
      {report.avgResponseMinutes !== null && (
        <p className="text-xs text-ink-muted">
          {tr('זמן תגובה ממוצע: {0}', durationLabel(report.avgResponseMinutes))}
        </p>
      )}
    </div>
  );
}

function Sources({ report }: { report: ReportSummary }) {
  const rows = [...report.bySource].sort((a, b) => b.count - a.count);
  const total = rows.reduce((n, r) => n + r.count, 0);
  return (
    <div className={card}>
      <h3 className="text-sm font-medium text-ink-muted">{tr('מאיפה הגיעו')}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-ink-muted">{tr('עוד אין פניות בטווח הזה.')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => (
            <li key={r.source} className="flex flex-col gap-1">
              <span className="flex items-center justify-between gap-2 text-sm text-ink">
                <span className="inline-flex items-center gap-1.5">
                  <LeadSourceIcon source={r.source} />
                  {tr(leadSourceLabels[r.source])}
                </span>
                <span className="tabular-nums">{r.count}</span>
              </span>
              <span aria-hidden className="h-1.5 overflow-hidden rounded-full bg-brand-100">
                <span
                  className="block h-full rounded-full bg-brand-600"
                  style={{ width: `${(r.count / total) * 100}%` }}
                />
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Funnel({ report, businessId }: { report: ReportSummary; businessId: string }) {
  return (
    <div className={card}>
      <h3 className="text-sm font-medium text-ink-muted">{tr('איפה הפניות עומדות')}</h3>
      <ul className="flex flex-col gap-1.5">
        {report.byStage.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-2 text-sm text-ink">
            <Link
              to={businessWebPaths.section(businessId, 'leads')}
              className="truncate hover:text-brand-700 hover:underline"
            >
              {s.name}
            </Link>
            <span className="tabular-nums">{s.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
