import {
  businessWebPaths,
  formatAgorot,
  quoteStatusLabels,
  QUOTE_STATUSES,
  type QuoteStatus,
} from '@leadflow/shared';
import { FileText } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { Alert, Spinner } from '../../components/ui';
import { cn } from '../../lib/cn';
import { errorMessage } from '../auth/serverErrors';
import { useCurrentBusiness } from '../shell/CurrentBusiness';
import { PageHeader } from '../shell/PageHeader';
import { dateFmt, displayStatus, quoteStatusTone, useQuotes } from './api';
import { tr } from '../../i18n';

/** F18: all quotes, newest first, filterable by status. New quotes start from a lead. */
export function QuotesPage() {
  const business = useCurrentBusiness();
  const [params, setParams] = useSearchParams();
  const status = (params.get('status') as QuoteStatus | null) ?? undefined;
  const quotes = useQuotes(business.id, { status });
  const base = businessWebPaths.section(business.id, 'quotes');
  const open = (quotes.data ?? []).filter((q) => q.status === 'SENT' && !q.expired);
  const openTotal = open.reduce((s, q) => s + q.totals.total, 0);

  return (
    <>
      <PageHeader
        title={tr('הצעות מחיר')}
        description={tr('כל ההצעות של העסק. הצעה חדשה נפתחת מתוך כרטיס הליד.')}
      />
      {/* One panel (D-116): the status filter on top, the quotes under it. */}
      <section
        aria-label={tr('הצעות מחיר')}
        className="overflow-hidden rounded-2xl border border-surface-border bg-surface shadow-card"
      >
        <div className="flex flex-wrap items-center gap-3 border-b border-surface-border p-4">
          <div
            role="group"
            aria-label={tr('סינון לפי סטטוס')}
            className="flex flex-wrap rounded-lg bg-surface-sunken p-0.5"
          >
            {[undefined, ...QUOTE_STATUSES].map((s) => (
              <button
                key={s ?? 'all'}
                type="button"
                aria-pressed={status === s}
                onClick={() => setParams(s ? { status: s } : {}, { replace: true })}
                className={cn(
                  'rounded-md px-3 py-1 text-sm',
                  status === s ? 'bg-surface text-ink shadow-card' : 'text-ink-muted',
                )}
              >
                {s ? tr(quoteStatusLabels[s]) : tr('הכול')}
              </button>
            ))}
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
          <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
              <FileText aria-hidden className="h-6 w-6" />
            </span>
            <h2 className="text-base font-semibold text-ink">
              {status ? tr('אין הצעות בסטטוס הזה') : tr('עדיין אין הצעות מחיר')}
            </h2>
            <p className="max-w-md text-sm text-ink-muted">
              {tr('פתחו ליד מ"לקוחות ולידים" ובחרו "הצעת מחיר חדשה".')}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
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
