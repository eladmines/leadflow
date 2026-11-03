import { formatAgorot, formatIsraeliPhone, quoteStatusLabels } from '@leadflow/shared';
import { CheckCircle2, Printer, XCircle } from 'lucide-react';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Alert, Button, FullPageSpinner } from '../../components/ui';
import { errorMessage } from '../auth/serverErrors';
import { dateFmt, usePublicDecision, usePublicQuote } from './api';
import { tr } from '../../i18n';

const ymdToLocal = (ymd: string) => ymd.split('-').reverse().join('/');

/**
 * The customer's quote page (F18): no login, the private link is the permission. Printable
 * ("save as PDF" from the browser's print dialog), with accept / reject.
 */
export function PublicQuotePage() {
  const { token = '' } = useParams();
  const quote = usePublicQuote(token);
  const decide = usePublicDecision(token);
  const [confirm, setConfirm] = useState<'accept' | 'reject' | null>(null);

  if (quote.isPending) return <FullPageSpinner label={tr('טוענים את הצעת המחיר…')} />;
  if (quote.isError) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 px-4 text-center">
        <h1 className="text-xl font-semibold text-ink">{tr('ההצעה לא נמצאה')}</h1>
        <p className="text-sm text-ink-muted">
          {tr('ייתכן שהקישור שגוי או שההצעה כבר אינה זמינה.')}
        </p>
      </main>
    );
  }
  const q = quote.data;
  const open = q.status === 'SENT' && !q.expired;

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-4 py-8 print:max-w-none print:py-0">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-surface-border pb-5">
        <div className="flex flex-col gap-1">
          <p className="text-lg font-semibold text-ink">{q.business.name}</p>
          <p className="text-sm text-ink-muted">
            {q.business.phone && <bdi dir="ltr">{formatIsraeliPhone(q.business.phone)}</bdi>}
            {q.business.phone && q.business.address && ' · '}
            {q.business.address}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 text-sm">
          <h1 className="text-xl font-semibold text-ink">
            {tr('הצעת מחיר מס׳')} {q.number}
          </h1>
          {q.sentAt && <p className="text-ink-muted">{dateFmt.format(new Date(q.sentAt))}</p>}
          {q.validUntil && (
            <p className="text-ink-muted">
              {tr('בתוקף עד')} {ymdToLocal(q.validUntil)}
            </p>
          )}
        </div>
      </header>

      <div className="flex flex-col gap-1">
        <p className="text-sm text-ink-muted">{tr('לכבוד')}</p>
        <p className="font-medium text-ink">{q.customerName}</p>
        {q.title && <p className="mt-2 text-base font-semibold text-ink">{q.title}</p>}
      </div>

      <table className="w-full text-sm">
        <thead className="border-b border-surface-border text-xs text-ink-muted">
          <tr>
            <th className="py-2 text-start font-medium">{tr('תיאור')}</th>
            <th className="py-2 text-end font-medium">{tr('כמות')}</th>
            <th className="py-2 text-end font-medium">{tr('מחיר יחידה')}</th>
            <th className="py-2 text-end font-medium">{tr('סה״כ')}</th>
          </tr>
        </thead>
        <tbody>
          {q.items.map((i, n) => (
            <tr key={n} className="border-b border-surface-border">
              <td className="py-2.5 text-ink">{i.description}</td>
              <td className="py-2.5 text-end tabular-nums">{i.quantity}</td>
              <td className="py-2.5 text-end tabular-nums">{formatAgorot(i.unitPrice)}</td>
              <td className="py-2.5 text-end tabular-nums">
                {formatAgorot(i.quantity * i.unitPrice)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <dl className="ms-auto flex w-full max-w-xs flex-col gap-1.5 text-sm">
        <div className="flex justify-between">
          <dt className="text-ink-muted">{tr('סכום ביניים')}</dt>
          <dd className="tabular-nums">{formatAgorot(q.totals.subtotal)}</dd>
        </div>
        {q.totals.discount > 0 && (
          <div className="flex justify-between">
            <dt className="text-ink-muted">{tr('הנחה')}</dt>
            <dd className="tabular-nums">
              <bdi dir="ltr">−{formatAgorot(q.totals.discount)}</bdi>
            </dd>
          </div>
        )}
        {q.vatRate > 0 && (
          <div className="flex justify-between">
            <dt className="text-ink-muted">
              {tr('מע״מ')} {q.vatRate}%
            </dt>
            <dd className="tabular-nums">{formatAgorot(q.totals.vat)}</dd>
          </div>
        )}
        <div className="flex justify-between border-t border-surface-border pt-2 text-base font-semibold">
          <dt>{tr('סה״כ לתשלום')}</dt>
          <dd className="tabular-nums">{formatAgorot(q.totals.total)}</dd>
        </div>
      </dl>

      {q.notes && (
        <section className="rounded-xl bg-surface-muted p-4 text-sm">
          <h2 className="mb-1 font-semibold text-ink">{tr('הערות ותנאים')}</h2>
          <p className="whitespace-pre-line text-ink-muted">{q.notes}</p>
        </section>
      )}

      <div className="flex flex-col gap-3 border-t border-surface-border pt-5 print:hidden">
        {decide.isError && <Alert tone="danger">{errorMessage(decide.error)}</Alert>}
        {q.status === 'ACCEPTED' && (
          <Alert tone="success">
            {tr('ההצעה אושרה. תודה!')} {q.business.name} {tr('יחזרו אליך להמשך.')}
          </Alert>
        )}
        {q.status === 'REJECTED' && <Alert tone="info">{tr('ההצעה נדחתה. תודה על העדכון.')}</Alert>}
        {q.expired && q.status === 'SENT' && (
          <Alert tone="warning">
            {tr(quoteStatusLabels.EXPIRED)}
            {tr(': אפשר לפנות ל')}
            {q.business.name} {tr('לקבלת הצעה מעודכנת.')}
          </Alert>
        )}
        <div className="flex flex-wrap gap-2">
          {open &&
            (confirm ? (
              <div
                role="group"
                aria-label={tr('אישור הבחירה')}
                className="flex flex-wrap items-center gap-2"
              >
                <span className="text-sm text-ink">
                  {confirm === 'accept' ? tr('לאשר את ההצעה?') : tr('לדחות את ההצעה?')}
                </span>
                <Button
                  variant={confirm === 'accept' ? 'primary' : 'danger'}
                  loading={decide.isPending}
                  onClick={() => decide.mutate(confirm, { onSettled: () => setConfirm(null) })}
                >
                  {confirm === 'accept' ? tr('כן, מאשר/ת') : tr('כן, לדחות')}
                </Button>
                <Button variant="ghost" onClick={() => setConfirm(null)}>
                  {tr('חזרה')}
                </Button>
              </div>
            ) : (
              <>
                <Button size="lg" onClick={() => setConfirm('accept')}>
                  <CheckCircle2 aria-hidden className="h-4 w-4" />
                  {tr('אישור ההצעה')}
                </Button>
                <Button size="lg" variant="secondary" onClick={() => setConfirm('reject')}>
                  <XCircle aria-hidden className="h-4 w-4" />
                  {tr('דחייה')}
                </Button>
              </>
            ))}
          <Button size="lg" variant="ghost" onClick={() => window.print()}>
            <Printer aria-hidden className="h-4 w-4" />
            {tr('הורדה כ־PDF / הדפסה')}
          </Button>
        </div>
      </div>
    </main>
  );
}
