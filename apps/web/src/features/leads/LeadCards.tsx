import {
  appointmentStatusLabels,
  businessWebPaths,
  formatAgorot,
  quoteStatusLabels,
  type Appointment,
  type Lead,
  type Quote,
  type Task,
} from '@simplecatch/shared';
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Button, buttonClasses, Spinner } from '../../components/ui';
import { cn } from '../../lib/cn';
import { ApiError } from '../../lib/api';
import { intlLocale, tr } from '../../i18n';
import { errorMessage } from '../auth/serverErrors';
import { useCurrentBusiness } from '../shell/CurrentBusiness';
import { NewTaskForm } from '../tasks/NewTaskForm';
import { TaskItem } from '../tasks/TaskItem';
import { useTasks } from '../tasks/api';
import { useAppointments } from '../appointments/api';
import { displayStatus, useQuotes } from '../quotes/api';
import { shekel } from './api';

const apptWhenFmt = new Intl.DateTimeFormat(intlLocale(), {
  weekday: 'short',
  day: 'numeric',
  month: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/** Loading, no-permission (403) or error, for one list. */
function ListStatus({
  query,
  loading,
  forbidden,
}: {
  query: { isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown };
  loading: string;
  forbidden: string;
}) {
  if (query.isPending) return <Spinner size="sm" label={loading} />;
  if (!query.isError) return null;
  if (query.error instanceof ApiError && query.error.status === 403) {
    return <p className="text-sm text-ink-muted">{forbidden}</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      <Alert tone="danger">{errorMessage(query.error)}</Alert>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        className="self-start"
        onClick={() => void query.refetch()}
      >
        {tr('נסו שוב')}
      </Button>
    </div>
  );
}

const byDue = (a: Task, b: Task) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();

/** The lead's open tasks, nearest first (the tasks tab, D-219). */
export function useLeadOpenTasks(lead: Lead) {
  const business = useCurrentBusiness();
  const query = useTasks(business.id, { leadId: lead.id });
  return { query, open: (query.data ?? []).filter((t) => t.status === 'OPEN').sort(byDue) };
}

/** The tasks tab: "+ משימה" (its form opens on demand) and the open tasks. */
export function LeadTasks({
  lead,
  tasks,
  formOpen,
  onFormOpenChange,
}: {
  lead: Lead;
  tasks: ReturnType<typeof useLeadOpenTasks>;
  formOpen: boolean;
  onFormOpenChange: (open: boolean) => void;
}) {
  const business = useCurrentBusiness();
  const addRef = useRef<HTMLButtonElement>(null);
  const formId = `lead-task-form-${lead.id}`;
  const close = () => {
    onFormOpenChange(false);
    addRef.current?.focus();
  };
  return (
    <>
      <Button
        ref={addRef}
        type="button"
        size="sm"
        variant="secondary"
        className="self-start"
        aria-expanded={formOpen}
        aria-controls={formOpen ? formId : undefined}
        onClick={() => (formOpen ? close() : onFormOpenChange(true))}
      >
        {tr('+ משימה')}
      </Button>
      {formOpen && (
        <div id={formId} className="flex flex-col gap-2 rounded-xl bg-surface-muted p-3">
          <NewTaskForm leadId={lead.id} compact autoFocus onCreated={close} />
          <Button type="button" variant="ghost" size="sm" className="self-start" onClick={close}>
            {tr('ביטול')}
          </Button>
        </div>
      )}
      <ListStatus
        query={tasks.query}
        loading={tr('טוענים את המשימות…')}
        forbidden={tr('אין לך הרשאה לראות את המשימות של הליד הזה.')}
      />
      {tasks.query.isSuccess &&
        (tasks.open.length > 0 ? (
          <ul aria-label={tr('משימות הליד')} className="divide-y divide-surface-border">
            {tasks.open.map((t) => (
              <TaskItem key={t.id} task={t} businessId={business.id} showLead={false} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-muted">{tr('אין משימות פתוחות לליד הזה.')}</p>
        ))}
    </>
  );
}

/** The lead's appointments (a month back, two ahead), with the visit's time fixed once. */
export function useLeadAppointments(lead: Lead) {
  const business = useCurrentBusiness();
  // Fixed once per visit, so the query key stays the same between renders.
  const [range] = useState(() => {
    const now = Date.now();
    return {
      now,
      // The server takes at most 62 days per request: two weeks back, seven weeks ahead.
      from: new Date(now - 14 * 86_400_000).toISOString(),
      to: new Date(now + 48 * 86_400_000).toISOString(),
    };
  });
  const query = useAppointments(business.id, {
    from: range.from,
    to: range.to,
    leadId: lead.id,
  });
  const at = (a: Appointment) => new Date(a.startsAt).getTime();
  const list = query.data ?? [];
  // Upcoming, nearest first; then past ones, latest first.
  const ordered = [
    ...list.filter((a) => at(a) >= range.now).sort((a, b) => at(a) - at(b)),
    ...list.filter((a) => at(a) < range.now).sort((a, b) => at(b) - at(a)),
  ];
  const upcoming = list.filter((a) => at(a) >= range.now).length;
  return { query, ordered, upcoming, now: range.now };
}

/** The appointments tab (D-219): "+ תור" and the list, upcoming first. */
export function LeadAppointments({
  appts,
  onBook,
}: {
  appts: ReturnType<typeof useLeadAppointments>;
  /** Opens the booking dialog (the page owns it, so the "+" menu can open it too). */
  onBook: () => void;
}) {
  const { query, ordered, now } = appts;
  return (
    <>
      <Button type="button" size="sm" variant="secondary" className="self-start" onClick={onBook}>
        {tr('+ תור')}
      </Button>
      <ListStatus
        query={query}
        loading={tr('טוענים את התורים…')}
        forbidden={tr('אין לך הרשאה לראות את התורים של הליד הזה.')}
      />
      {query.isSuccess &&
        (ordered.length > 0 ? (
          <ul aria-label={tr('תורי הליד')} className="flex flex-col gap-1.5">
            {ordered.map((a) => {
              const past = new Date(a.startsAt).getTime() < now;
              return (
                <li key={a.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className={cn('min-w-0', past ? 'text-ink-muted' : 'text-ink')}>
                    <time dateTime={a.startsAt}>{apptWhenFmt.format(new Date(a.startsAt))}</time>
                    {a.service && <span className="text-ink-muted"> · {a.service.name}</span>}
                  </span>
                  <span className="shrink-0 text-xs text-ink-muted">
                    {tr(appointmentStatusLabels[a.status])}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-ink-muted">{tr('אין תורים קרובים.')}</p>
        ))}
    </>
  );
}

export const leadQuotesNewestFirst = (a: Quote, b: Quote) =>
  new Date(b.sentAt ?? b.createdAt).getTime() - new Date(a.sentAt ?? a.createdAt).getTime();

export function useLeadQuotes(lead: Lead) {
  const business = useCurrentBusiness();
  const query = useQuotes(business.id, { leadId: lead.id });
  return { query, list: [...(query.data ?? [])].sort(leadQuotesNewestFirst) };
}

const statusTone: Record<ReturnType<typeof displayStatus>, string> = {
  DRAFT: 'bg-surface-muted text-ink-muted ring-surface-border',
  SENT: 'bg-brand-50 text-brand-800 ring-brand-200',
  ACCEPTED: 'bg-success-50 text-success-600 ring-success-600/30',
  REJECTED: 'bg-danger-50 text-danger-700 ring-danger-600/30',
  EXPIRED: 'bg-warning-50 text-warning-600 ring-warning-600/30',
};

/** The lead's value from its quotes, "₪X פתוח · ₪Y נסגר" (D-207; shown once, in the properties, D-218). */
export function valueSummary(lead: Lead) {
  const value = lead.value ?? { won: 0, open: 0 };
  return tr('{0} פתוח · {1} נסגר', shekel.format(value.open), shekel.format(value.won));
}

/** The quotes tab (D-219): "+ הצעה" and each quote with its status and total. */
export function LeadQuotes({
  lead,
  quotes,
}: {
  lead: Lead;
  quotes: ReturnType<typeof useLeadQuotes>;
}) {
  const business = useCurrentBusiness();
  const base = businessWebPaths.section(business.id, 'quotes');
  const { query, list } = quotes;

  return (
    <>
      <Link
        to={`${base}/new?leadId=${lead.id}`}
        className={cn(buttonClasses('secondary', 'sm'), 'self-start')}
      >
        {tr('+ הצעה')}
      </Link>
      <ListStatus
        query={query}
        loading={tr('טוענים את הצעות המחיר…')}
        forbidden={tr('אין לך הרשאה לראות את הצעות המחיר של הליד הזה.')}
      />
      {query.isSuccess &&
        (list.length > 0 ? (
          <ul aria-label={tr('הצעות המחיר של הליד')} className="flex flex-col gap-1.5">
            {list.map((q) => {
              const status = displayStatus(q);
              return (
                <li key={q.id} className="flex items-center justify-between gap-2 text-sm">
                  <Link to={`${base}/${q.id}`} className="min-w-0 text-brand-700 hover:underline">
                    {tr('מס׳')} {q.number} · {formatAgorot(q.totals.total)}
                  </Link>
                  <span
                    className={cn(
                      'shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
                      statusTone[status],
                    )}
                  >
                    {tr(quoteStatusLabels[status])}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-ink-muted">
            {tr('אין עדיין הצעות. ערך הליד נקבע לפי הצעות המחיר שלו.')}
          </p>
        ))}
    </>
  );
}
