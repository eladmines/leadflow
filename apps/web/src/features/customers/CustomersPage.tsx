import {
  appointmentStatusLabels,
  attributionName,
  businessWebPaths,
  formatIsraeliPhone,
  type Customer,
} from '@leadflow/shared';
import { ChevronDown, Crown, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, EmptyState, Spinner } from '../../components/ui';
import { inputClasses } from '../../components/ui/Field';
import { cn } from '../../lib/cn';
import { errorMessage } from '../auth/serverErrors';
import { SourceBadge } from '../leads/Attribution';
import { formatDateTime, shekel } from '../leads/api';
import { useCurrentBusiness } from '../shell/CurrentBusiness';
import { PageHeader } from '../shell/PageHeader';
import { useCustomers } from './api';
import { tr } from '../../i18n';

/**
 * Customers (D-163, D-178): everyone who bought — a lead moved to Won or an accepted quote — and
 * everyone who booked an appointment (also a cancelled or missed one). One row per person with
 * their total, and their purchases and bookings when opened.
 */
export function CustomersPage() {
  const business = useCurrentBusiness();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 300);
    return () => clearTimeout(t);
  }, [text]);
  const customers = useCustomers(business.id, q);
  const total = customers.data?.reduce((sum, c) => sum + c.totalValue, 0) ?? 0;

  return (
    <section
      aria-label={tr('לקוחות')}
      className="overflow-hidden rounded-2xl border border-surface-border bg-surface shadow-card"
    >
      <PageHeader
        inPanel
        title={tr('לקוחות')}
        description={tr(
          'מי שקנה מכם (ליד בשלב "נסגר" או הצעת מחיר שאושרה) ומי שקבע תור, גם אם ביטל.',
        )}
      />
      <div role="search" className="border-b border-surface-border p-4">
        <div className="relative max-w-md">
          <Search
            aria-hidden
            className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle"
          />
          <label htmlFor="customer-search" className="sr-only">
            {tr('חיפוש לקוחות')}
          </label>
          <input
            id="customer-search"
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={tr('חיפוש לפי שם, טלפון או אימייל')}
            className={cn(inputClasses(false), 'ps-9')}
          />
        </div>
      </div>
      <div className="flex flex-col gap-4 p-4">
        {customers.isPending ? (
          <Spinner label={tr('טוענים לקוחות…')} />
        ) : customers.isError ? (
          <Alert tone="danger" title={tr('לא הצלחנו לטעון את הלקוחות')}>
            {errorMessage(customers.error)}
          </Alert>
        ) : customers.data.length === 0 ? (
          <EmptyState
            bare
            icon={Crown}
            tone="bg-amber-500"
            title={q ? tr('לא נמצאו לקוחות') : tr('עוד אין לקוחות')}
            description={
              q
                ? tr('נסו שם או מספר אחר.')
                : tr('כשליד יעבור לשלב "נסגר", יאשר הצעת מחיר או יקבע תור, הוא יופיע כאן.')
            }
            action={
              q ? undefined : (
                <Link
                  to={businessWebPaths.section(business.id, 'leads')}
                  className="text-sm font-medium text-brand-700 underline"
                >
                  {tr('ללידים')}
                </Link>
              )
            }
          />
        ) : (
          <>
            <p className="text-sm text-ink-muted">
              {tr('{0} לקוחות · סך הכול {1}', customers.data.length, shekel.format(total))}
            </p>
            <ul className="flex flex-col gap-2">
              {customers.data.map((c) => (
                <CustomerRow key={c.contactId} customer={c} businessId={business.id} />
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}

/** "2 purchases · one booking": what this person has with the business. */
function summary(c: Customer) {
  const parts = [
    c.purchases.length === 0
      ? null
      : c.purchases.length === 1
        ? tr('רכישה אחת')
        : tr('{0} רכישות', c.purchases.length),
    c.bookings.length === 0
      ? null
      : c.bookings.length === 1
        ? tr('תור אחד')
        : tr('{0} תורים', c.bookings.length),
  ];
  return parts.filter(Boolean).join(' · ');
}

function CustomerRow({ customer: c, businessId }: { customer: Customer; businessId: string }) {
  const [open, setOpen] = useState(false);
  const panelId = `customer-${c.contactId}`;
  const named =
    c.attribution && (c.attribution.source === 'utm' || c.attribution.source === 'referral')
      ? attributionName(c.attribution)
      : null;
  return (
    <li className="rounded-2xl border border-surface-border">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl p-4 text-start hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
      >
        <span
          aria-hidden
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 font-semibold text-amber-800"
        >
          {c.name.trim().charAt(0)}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="font-medium text-ink">{c.name}</span>
          <span className="text-sm text-ink-muted">
            {c.phone ? (
              <bdi dir="ltr">{formatIsraeliPhone(c.phone)}</bdi>
            ) : (
              <bdi dir="ltr">{c.email}</bdi>
            )}
          </span>
        </span>
        <SourceBadge source={c.attribution?.source ?? 'unknown'} name={named} />
        <span className="flex flex-col items-end text-sm">
          {c.purchases.length > 0 && (
            <span className="font-semibold tabular-nums text-emerald-700">
              <bdi>{shekel.format(c.totalValue)}</bdi>
            </span>
          )}
          <span className="text-ink-muted">{summary(c)}</span>
        </span>
        <ChevronDown
          aria-hidden
          className={cn('h-5 w-5 text-ink-muted transition-transform', open && 'rotate-180')}
        />
      </button>
      {open && (
        <div id={panelId} className="flex flex-col border-t border-surface-border">
          {c.purchases.length > 0 && (
            <ul aria-label={tr('הרכישות של {0}', c.name)} className="flex flex-col">
              {c.purchases.map((p) => (
                <li key={p.leadId} className="border-b border-surface-border last:border-b-0">
                  <Link
                    to={`${businessWebPaths.section(businessId, 'leads')}/${p.leadId}`}
                    className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm hover:bg-surface-muted"
                  >
                    <span className="text-ink">{formatDateTime(p.at)}</span>
                    <span className="text-ink-muted">
                      {p.via === 'quote' ? tr('הצעת מחיר שאושרה') : tr('נסגר')}
                    </span>
                    <span className="tabular-nums text-ink">
                      <bdi>{p.value === null ? '—' : shekel.format(p.value)}</bdi>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {c.bookings.length > 0 && (
            <ul
              aria-label={tr('התורים של {0}', c.name)}
              className={cn(
                'flex flex-col',
                c.purchases.length > 0 && 'border-t border-surface-border',
              )}
            >
              {c.bookings.map((b) => (
                <li
                  key={b.appointmentId}
                  className="border-b border-surface-border last:border-b-0"
                >
                  <Link
                    to={
                      b.leadId
                        ? `${businessWebPaths.section(businessId, 'leads')}/${b.leadId}`
                        : `${businessWebPaths.section(businessId, 'appointments')}?date=${new Date(b.startsAt).toLocaleDateString('en-CA')}`
                    }
                    className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm hover:bg-surface-muted"
                  >
                    <span className="text-ink">{formatDateTime(b.startsAt)}</span>
                    <span className="text-ink-muted">{b.serviceName ?? tr('תור')}</span>
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-xs font-medium',
                        b.status === 'CANCELLED' || b.status === 'NO_SHOW'
                          ? 'bg-rose-50 text-rose-700'
                          : 'bg-emerald-50 text-emerald-700',
                      )}
                    >
                      {tr(appointmentStatusLabels[b.status])}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}
