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
import { AlarmClock, AlertTriangle, Check, ChevronDown, UserRound } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Button, buttonClasses, Card, Spinner } from '../../components/ui';
import { cn } from '../../lib/cn';
import { ApiError } from '../../lib/api';
import { intlLocale, tr } from '../../i18n';
import { errorMessage } from '../auth/serverErrors';
import { useCurrentBusiness } from '../shell/CurrentBusiness';
import { NewTaskForm } from '../tasks/NewTaskForm';
import { TaskItem } from '../tasks/TaskItem';
import { dueLabel, useTasks, useUpdateTask } from '../tasks/api';
import { useAppointments } from '../appointments/api';
import { NewAppointmentDialog } from '../appointments/NewAppointmentDialog';
import { displayStatus, useQuotes } from '../quotes/api';
import { shekel } from './api';

/**
 * The lead page's folded parts (D-211). Old `?tab=tasks|appointments|quotes` links open the
 * matching one and focus its button.
 */
export const LEAD_SECTIONS = ['tasks', 'appointments', 'quotes', 'more'] as const;
export type LeadSectionKey = (typeof LEAD_SECTIONS)[number];
export const leadSectionId = (key: LeadSectionKey) => `lead-section-${key}`;
/** The disclosure button of a section (what an old link focuses). */
export const leadSectionButtonId = (key: LeadSectionKey) => `${leadSectionId(key)}-button`;

const apptWhenFmt = new Intl.DateTimeFormat(intlLocale(), {
  weekday: 'short',
  day: 'numeric',
  month: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const disclosureClasses =
  'rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2';

/**
 * A folded one-line section (D-211): a heading button with a count or summary that opens the
 * content below it (`aria-expanded`, keyboard: Enter/Space as any button).
 */
export function Fold({
  sectionKey,
  title,
  summary,
  open,
  onOpenChange,
  children,
}: {
  sectionKey: LeadSectionKey;
  title: string;
  summary?: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  const id = leadSectionId(sectionKey);
  return (
    <section id={id} className="scroll-mt-24 rounded-xl border border-surface-border bg-surface">
      <h2>
        <button
          id={leadSectionButtonId(sectionKey)}
          type="button"
          aria-expanded={open}
          aria-controls={`${id}-panel`}
          onClick={() => onOpenChange(!open)}
          className={cn(
            'flex w-full items-center gap-3 px-4 py-3 text-start hover:bg-surface-muted',
            disclosureClasses,
          )}
        >
          <span className="font-semibold text-ink">{title}</span>
          {summary && (
            <span className="min-w-0 flex-1 truncate text-sm text-ink-muted">{summary}</span>
          )}
          <ChevronDown
            aria-hidden
            className={cn(
              'ms-auto h-4 w-4 shrink-0 text-ink-muted transition-transform',
              open && 'rotate-180',
            )}
          />
        </button>
      </h2>
      {open && (
        <div
          id={`${id}-panel`}
          role="region"
          aria-labelledby={leadSectionButtonId(sectionKey)}
          className="flex flex-col gap-3 border-t border-surface-border px-4 py-3"
        >
          {children}
        </div>
      )}
    </section>
  );
}

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

const isLate = (dueAt: string, now = Date.now()) => new Date(dueAt).getTime() < now;
const byDue = (a: Task, b: Task) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();

/**
 * Next action (D-209, D-211): the lead's nearest open task the member may see (`lead.nextTask`)
 * with a "done" button and "+ משימה"; the lead's other open tasks behind "כל המשימות (N)".
 * Overdue is said in words, not only in red.
 */
export function NextAction({
  lead,
  formOpen,
  onFormOpenChange,
  tasksOpen,
  onTasksOpenChange,
}: {
  lead: Lead;
  formOpen: boolean;
  onFormOpenChange: (open: boolean) => void;
  tasksOpen: boolean;
  onTasksOpenChange: (open: boolean) => void;
}) {
  const business = useCurrentBusiness();
  const tasks = useTasks(business.id, { leadId: lead.id });
  const update = useUpdateTask(business.id);
  const addRef = useRef<HTMLButtonElement>(null);
  const next = lead.nextTask ?? null;
  const late = next ? isLate(next.dueAt) : false;
  const open = (tasks.data ?? []).filter((t) => t.status === 'OPEN').sort(byDue);
  const formId = `${leadSectionId('tasks')}-form`;
  const listId = `${leadSectionId('tasks')}-panel`;
  const closeForm = () => {
    onFormOpenChange(false);
    addRef.current?.focus();
  };

  return (
    <Card
      role="region"
      aria-labelledby="lead-next-title"
      className={cn('flex flex-col gap-3', late && 'border-danger-600/40')}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="lead-next-title" className="text-base font-semibold text-ink">
          {tr('הפעולה הבאה')}
        </h2>
        <Button
          ref={addRef}
          type="button"
          size="sm"
          variant="secondary"
          aria-expanded={formOpen}
          aria-controls={formOpen ? formId : undefined}
          onClick={() => (formOpen ? closeForm() : onFormOpenChange(true))}
        >
          {tr('+ משימה')}
        </Button>
      </div>
      {next ? (
        <div className="flex items-start gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <p className="min-w-0 font-medium text-ink [overflow-wrap:anywhere]">
              <bdi>{next.title}</bdi>
            </p>
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
              <span
                className={cn(
                  'inline-flex items-center gap-1',
                  late && 'font-semibold text-danger-700',
                )}
              >
                {late ? (
                  <AlertTriangle aria-hidden className="h-3.5 w-3.5" />
                ) : (
                  <AlarmClock aria-hidden className="h-3.5 w-3.5" />
                )}
                <time dateTime={next.dueAt}>{dueLabel(next.dueAt)}</time>
                {late && <span>· {tr('באיחור')}</span>}
              </span>
              <span className="inline-flex items-center gap-1">
                <UserRound aria-hidden className="h-3.5 w-3.5" />
                <span className="sr-only">{tr('אחראי:')}</span>
                {next.assignee.name}
              </span>
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            loading={update.isPending}
            aria-label={tr('סימון כבוצעה: {0}', next.title)}
            onClick={() => update.mutate({ id: next.id, body: { status: 'DONE' } })}
          >
            <Check aria-hidden className="h-4 w-4" />
            {tr('בוצע')}
          </Button>
        </div>
      ) : (
        <p className="text-sm text-ink-muted">
          {tr('אין פעולה הבאה. כדאי להוסיף משימה כדי לא לשכוח לחזור ללקוח.')}
        </p>
      )}
      {update.isError && <Alert tone="danger">{errorMessage(update.error)}</Alert>}
      {formOpen && (
        <div id={formId} className="flex flex-col gap-2 rounded-xl bg-surface-muted p-3">
          <NewTaskForm leadId={lead.id} compact autoFocus onCreated={closeForm} />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="self-start"
            onClick={closeForm}
          >
            {tr('ביטול')}
          </Button>
        </div>
      )}
      <div id={leadSectionId('tasks')} className="scroll-mt-24 border-t border-surface-border pt-2">
        <button
          id={leadSectionButtonId('tasks')}
          type="button"
          aria-expanded={tasksOpen}
          aria-controls={listId}
          onClick={() => onTasksOpenChange(!tasksOpen)}
          className={cn(
            'inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline',
            disclosureClasses,
          )}
        >
          {tasks.isSuccess ? tr('כל המשימות ({0})', open.length) : tr('כל המשימות')}
          <ChevronDown
            aria-hidden
            className={cn('h-4 w-4 transition-transform', tasksOpen && 'rotate-180')}
          />
        </button>
        {tasksOpen && (
          <div id={listId} className="mt-2 flex flex-col gap-2">
            <ListStatus
              query={tasks}
              loading={tr('טוענים את המשימות…')}
              forbidden={tr('אין לך הרשאה לראות את המשימות של הליד הזה.')}
            />
            {tasks.isSuccess &&
              (open.length > 0 ? (
                <ul aria-label={tr('משימות הליד')} className="divide-y divide-surface-border">
                  {open.map((t) => (
                    <TaskItem key={t.id} task={t} businessId={business.id} showLead={false} />
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-ink-muted">{tr('אין משימות פתוחות לליד הזה.')}</p>
              ))}
          </div>
        )}
      </div>
    </Card>
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
      from: new Date(now - 30 * 86_400_000).toISOString(),
      to: new Date(now + 62 * 86_400_000).toISOString(),
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

/** Inside the folded "תורים" section: the list and "+ תור". */
export function LeadAppointments({
  lead,
  appts,
}: {
  lead: Lead;
  appts: ReturnType<typeof useLeadAppointments>;
}) {
  const [open, setOpen] = useState(false);
  const { query, ordered, now } = appts;
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        className="self-start"
        onClick={() => setOpen(true)}
      >
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
      <NewAppointmentDialog open={open} onOpenChange={setOpen} lead={lead} />
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

/** The lead's value as the folded quotes line says it: "₪X פתוח / ₪Y נסגר" (D-207, D-211). */
export function quotesSummary(lead: Lead) {
  const value = lead.value ?? { won: 0, open: 0 };
  return tr('{0} פתוח / {1} נסגר', shekel.format(value.open), shekel.format(value.won));
}

/**
 * Inside the folded "הצעות מחיר" section: the lead's value from its quotes (won = accepted,
 * open = the latest sent quote still open, D-207), each quote's status and total, "+ הצעה".
 */
export function LeadQuotes({
  lead,
  quotes,
}: {
  lead: Lead;
  quotes: ReturnType<typeof useLeadQuotes>;
}) {
  const business = useCurrentBusiness();
  const base = businessWebPaths.section(business.id, 'quotes');
  const value = lead.value ?? { won: 0, open: 0 };
  const { query, list } = quotes;

  return (
    <>
      <Link
        to={`${base}/new?leadId=${lead.id}`}
        className={cn(buttonClasses('secondary', 'sm'), 'self-start')}
      >
        {tr('+ הצעה')}
      </Link>
      <div className="flex flex-col gap-1.5 rounded-xl bg-surface-muted p-3">
        <p className="text-xs font-medium text-ink-muted">{tr('ערך הליד, לפי הצעות המחיר')}</p>
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <div className="flex flex-col">
            <dt className="text-xs text-ink-muted">{tr('נסגר (הצעות שאושרו)')}</dt>
            <dd className="font-semibold text-ink">{shekel.format(value.won)}</dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-xs text-ink-muted">{tr('פתוח (ההצעה האחרונה שנשלחה)')}</dt>
            <dd className="font-semibold text-ink">{shekel.format(value.open)}</dd>
          </div>
        </dl>
      </div>
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
