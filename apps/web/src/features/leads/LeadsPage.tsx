import {
  businessWebPaths,
  can,
  formatIsraeliPhone,
  leadSourceLabels,
  type Lead,
} from '@leadflow/shared';
import { Inbox, Mail, Phone } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Alert, buttonClasses, Spinner } from '../../components/ui';
import { cn } from '../../lib/cn';
import { errorMessage } from '../auth/serverErrors';
import { useCurrentBusiness } from '../shell/CurrentBusiness';
import { PageHeader } from '../shell/PageHeader';
import { useSite } from '../site/api';
import { timeAgo, useLeads } from './api';

const stageTone: Record<Lead['stage']['kind'], string> = {
  OPEN: 'bg-brand-50 text-brand-800',
  WON: 'bg-success-50 text-success-600',
  LOST: 'bg-surface-sunken text-ink-muted',
};

export function LeadCard({ lead }: { lead: Lead }) {
  const phone = lead.contact.phone;
  return (
    <article className="flex flex-col gap-3 rounded-2xl border border-surface-border bg-surface p-4 shadow-card sm:p-5">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-100 font-semibold text-accent-700"
          >
            {lead.contact.name.trim().charAt(0)}
          </span>
          <div className="flex flex-col">
            <h2 className="font-semibold text-ink">{lead.contact.name}</h2>
            <p className="text-xs text-ink-muted">
              {leadSourceLabels[lead.source]} ·{' '}
              <time
                dateTime={lead.createdAt}
                title={new Date(lead.createdAt).toLocaleString('he-IL')}
              >
                {timeAgo(lead.createdAt)}
              </time>
            </p>
          </div>
        </div>
        <span
          className={cn('rounded-full px-2.5 py-1 text-xs font-medium', stageTone[lead.stage.kind])}
        >
          {lead.stage.name}
        </span>
      </header>
      {lead.message && <p className="whitespace-pre-line text-sm text-ink">{lead.message}</p>}
      <div className="flex flex-wrap gap-2">
        {phone && (
          <a
            href={`tel:${phone}`}
            className="inline-flex items-center gap-1.5 rounded-xl bg-brand-50 px-3 py-1.5 text-sm font-medium text-brand-800 hover:bg-brand-100"
          >
            <Phone aria-hidden className="h-4 w-4" />
            <bdi dir="ltr">{formatIsraeliPhone(phone)}</bdi>
          </a>
        )}
        {lead.contact.email && (
          <a
            href={`mailto:${lead.contact.email}`}
            className="inline-flex items-center gap-1.5 rounded-xl bg-surface-muted px-3 py-1.5 text-sm text-ink hover:bg-surface-sunken"
          >
            <Mail aria-hidden className="h-4 w-4" />
            <bdi dir="ltr">{lead.contact.email}</bdi>
          </a>
        )}
      </div>
    </article>
  );
}

/** F07: every website inquiry, newest first. F08 adds the pipeline board, lead card and notes. */
export function LeadsPage() {
  const business = useCurrentBusiness();
  const leads = useLeads(business.id);
  const site = useSite(business.id);
  const live = Boolean(site.data?.published);
  const seesAll = can(business.role, 'leads.view.all');

  return (
    <>
      <PageHeader
        title="לקוחות ולידים"
        description={seesAll ? 'כל הפניות שהגיעו לעסק, מהחדשה לישנה.' : 'הפניות שהוקצו לך.'}
      />
      {leads.isPending ? (
        <Spinner label="טוענים פניות…" />
      ) : leads.isError ? (
        <Alert tone="danger" title="לא הצלחנו לטעון את הפניות">
          {errorMessage(leads.error)}
        </Alert>
      ) : leads.data.length === 0 ? (
        <section className="flex flex-col items-center gap-3 rounded-3xl border border-surface-border bg-surface px-6 py-16 text-center shadow-card">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
            <Inbox aria-hidden className="h-7 w-7" />
          </span>
          <h2 className="text-lg font-semibold text-ink">עדיין אין פניות</h2>
          {!seesAll ? (
            <p className="max-w-md text-sm text-ink-muted">כשיוקצו לך פניות, הן יופיעו כאן.</p>
          ) : live ? (
            <p className="max-w-md text-sm text-ink-muted">
              האתר באוויר עם טופס פנייה. שתפו את הכתובת{' '}
              <bdi dir="ltr" className="font-medium text-ink">
                {site.data?.publicUrl?.replace(/^https?:\/\//, '')}
              </bdi>{' '}
              — כל פנייה תופיע כאן ותגיע אליך באימייל.
            </p>
          ) : (
            <>
              <p className="max-w-md text-sm text-ink-muted">
                אחרי שהאתר יפורסם, כל פנייה מהטופס באתר תופיע כאן ותגיע אליך באימייל.
              </p>
              {can(business.role, 'site.edit') && (
                <Link
                  to={businessWebPaths.section(business.id, 'site')}
                  className={buttonClasses('primary', 'md')}
                >
                  לבניית האתר
                </Link>
              )}
            </>
          )}
        </section>
      ) : (
        <>
          <p className="text-sm text-ink-muted" aria-live="polite">
            {leads.data.length} פניות
          </p>
          <ul aria-label="פניות" className="grid gap-4 lg:grid-cols-2">
            {leads.data.map((lead) => (
              <li key={lead.id}>
                <LeadCard lead={lead} />
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
