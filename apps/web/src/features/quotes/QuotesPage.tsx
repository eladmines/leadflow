import {
  businessWebPaths,
  formatAgorot,
  quoteStatusLabels,
  QUOTE_STATUSES,
  type QuoteStatus,
} from '@simplecatch/shared';
import { FileText, Plus } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { Alert, buttonClasses, EmptyState, Spinner } from '../../components/ui';
import { cn } from '../../lib/cn';
import { errorMessage } from '../auth/serverErrors';
import { useCurrentBusiness } from '../shell/CurrentBusiness';
import { PageHeader } from '../shell/PageHeader';
import { dateFmt, displayStatus, quoteStatusTone, useQuotes } from './api';
import { tr } from '../../i18n';

/** F18: all quotes, newest first, filterable by status. A new quote starts from a lead. */
export function QuotesPage() {
  const business = useCurrentBusiness();
  const [params, setParams] = useSearchParams();
  const status = (params.get('status') as QuoteStatus | null) ?? undefined;
  // All quotes once, filtered here, so each status tab can show its count (owner, 2026-11-28).
  const all = useQuotes(business.id);
  const shown = status ? (all.data ?? []).filter((q) => q.status === status) : (all.data ?? []);
  const quotes = { ...all, data: all.data ? shown : undefined } as typeof all;
  const countOf = (s?: QuoteStatus) =>
    s ? (all.data ?? []).filter((q) => q.status === s).length : (all.data?.length ?? 0);
  const base = businessWebPaths.section(business.id, 'quotes');
  const open = (all.data ?? []).filter((q) => q.status === 'SENT' && !q.expired);
  const openTotal = open.reduce((s, q) => s + q.totals.total, 0);

  return (
    <>
      {/* One panel (D-116): the status filter on top, the quotes under it. */}
      <section
        aria-label={tr('הצעות מחיר')}
        className="overflow-hidden rounded-2xl border border-surface-border bg-surface shadow-card"
      >
        <PageHeader
          inPanel
          refresh
          title={tr('הצעות מחיר')}
          description={tr('כל ההצעות של העסק. אפשר ליצור הצעה חדשה גם מכרטיס הליד.')}
          actions={
            <Link to={`${base}/new`} className={buttonClasses('primary', 'md')}>
              <Plus aria-hidden className="h-4 w-4" />
              {tr('הצעת מחיר חדשה')}
            </Link>
          }
        />
        <div className="flex flex-wrap items-center gap-3 border-b border-surface-border px-4 pt-2">
          {/* Tabs like the lead page (underline), each with its count when it isn't 0. */}
          <div role="group" aria-label={tr('סינון לפי סטטוס')} className="flex flex-wrap">
            {[undefined, ...QUOTE_STATUSES].map((s) => {
              const n = countOf(s);
              const label = s ? tr(quoteStatusLabels[s]) : tr('הכול');
              return (
                <button
                  key={s ?? 'all'}
                  type="button"
                  aria-pressed={status === s}
                  aria-label={n > 0 ? `${label}, ${n}` : label}
                  onClick={() => setParams(s ? { status: s } : {}, { replace: true })}
                  className={cn(
                    '-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-400',
                    status === s
                      ? 'border-brand-600 text-brand-700'
                      : 'border-transparent text-ink-muted hover:text-ink',
                  )}
                >
                  <span aria-hidden>{label}</span>
                  {n > 0 && (
                    <span
                      aria-hidden
                      className="rounded-full bg-surface-muted px-1.5 text-xs font-normal text-ink-muted"
                    >
                      {n}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {!status && open.length > 0 && (
            <p className="text-sm text-ink-muted">
              {open.length} {tr('הצעות ממתינות לתשובה ·')} {formatAgorot(openTotal)}
            </p>
          )}
        </div>

        {quotes.isPending ? (
          <div className="p-4">
            <Spinner label={tr('טוענים הצעות…')} />
          </div>
        ) : quotes.isError ? (
          <div className="p-4">
            <Alert tone="danger">{errorMessage(quotes.error)}</Alert>
          </div>
        ) : quotes.data.length === 0 ? (
          <EmptyState
            bare
            icon={FileText}
            tone="bg-orange-500"
            title={status ? tr('אין הצעות בסטטוס הזה') : tr('עדיין אין הצעות מחיר')}
            description={tr('לוחצים על "הצעת מחיר חדשה", בוחרים לקוח, ובונים את ההצעה.')}
          />
        ) : (
          <div className="scrollbar-visible overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead className="bg-surface-muted text-xs text-ink-muted">
                <tr>
                  <th className="px-4 py-2.5 text-start font-medium">{tr('מס׳')}</th>
                  <th className="px-4 py-2.5 text-start font-medium">{tr('לקוח')}</th>
                  <th className="px-4 py-2.5 text-start font-medium">{tr('כותרת')}</th>
                  <th className="px-4 py-2.5 text-start font-medium">{tr('סטטוס')}</th>
                  <th className="px-4 py-2.5 text-end font-medium">{tr('סה״כ')}</th>
                  <th className="px-4 py-2.5 text-end font-medium">{tr('תאריך')}</th>
                </tr>
              </thead>
              <tbody>
                {quotes.data.map((q) => {
                  const s = displayStatus(q);
                  return (
                    <tr
                      key={q.id}
                      className="border-t border-surface-border first:border-t-0 hover:bg-surface-muted/60"
                    >
                      <td className="px-4 py-3 tabular-nums">
                        <Link
                          to={`${base}/${q.id}`}
                          className="font-medium text-brand-700 hover:underline"
                        >
                          {q.number}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-ink">{q.customer.name}</td>
                      <td className="px-4 py-3 text-ink-muted">{q.title || '—'}</td>
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            'rounded-full px-2 py-0.5 text-xs font-medium',
                            quoteStatusTone[s],
                          )}
                        >
                          {tr(quoteStatusLabels[s])}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-end tabular-nums text-ink">
                        {formatAgorot(q.totals.total)}
                      </td>
                      <td className="px-4 py-3 text-end text-ink-muted">
                        {dateFmt.format(new Date(q.sentAt ?? q.createdAt))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
