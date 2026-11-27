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
import { AlarmClock, AlertTriangle, UserRound } from 'lucide-react';
import { useRef, useState, type ReactNode, type RefObject } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Button, buttonClasses, Card, Spinner } from '../../components/ui';
import { cn } from '../../lib/cn';
import { ApiError } from '../../lib/api';
import { intlLocale, tr } from '../../i18n';
import { errorMessage } from '../auth/serverErrors';
import { useCurrentBusiness } from '../shell/CurrentBusiness';
import { NewTaskForm } from '../tasks/NewTaskForm';
import { TaskItem } from '../tasks/TaskItem';
import { dueLabel, useTasks } from '../tasks/api';
import { useAppointments } from '../appointments/api';
import { NewAppointmentDialog } from '../appointments/NewAppointmentDialog';
import { displayStatus, useQuotes } from '../quotes/api';
import { shekel } from './api';

/** How many items a card shows before "show all" (D-209). */
const SUMMARY = 3;

/** The lead page's cards (D-209); old `?tab=` links scroll to them. */
export const LEAD_CARDS = ['tasks', 'appointments', 'quotes'] as const;
export type LeadCardKey = (typeof LEAD_CARDS)[number];
export const leadCardId = (key: LeadCardKey) => `lead-card-${key}`;

const apptWhenFmt = new Intl.DateTimeFormat(intlLocale(), {
  weekday: 'short',
  day: 'numeric',
  month: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/**
 * A side card of the lead page: a heading (focusable, so an old tab link can land on it), a "+"
 * action and its body.
 */
function SideCard({
  cardKey,
  title,
  action,
  children,
}: {
  cardKey: LeadCardKey;
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const id = leadCardId(cardKey);
  return (
    <Card
      id={id}
      role="region"
      aria-labelledby={`${id}-title`}
      className="flex scroll-mt-24 flex-col gap-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2
          id={`${id}-title`}
          tabIndex={-1}
          className="rounded text-lg font-semibold text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
        >
          {title}
        </h2>
        {action}
      </div>
      {children}
    </Card>
  );
}

/** Loading, no-permission (403) or error, for one card's list. */
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

function ShowAll({
  total,
  all,
  onToggle,
  controls,
}: {
  total: number;
  all: boolean;
  onToggle: () => void;
  controls: string;
}) {
  if (total <= SUMMARY) return null;
  return (
    <button
      type="button"
      aria-expanded={all}
      aria-controls={controls}
      onClick={onToggle}
      className="self-start rounded text-sm font-medium text-brand-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
    >
      {all ? tr('הצגת פחות') : tr('הצג הכול ({0})', total)}
    </button>
  );
}

/** The "+" that opens a card's add form; says whether the form is open. */
function AddButton({
  label,
  open,
  controls,
  onClick,
  buttonRef,
}: {
  label: string;
  open?: boolean;
  controls?: string;
  onClick: () => void;
  buttonRef?: RefObject<HTMLButtonElement>;
}) {
  return (
    <Button
      ref={buttonRef}
      type="button"
      size="sm"
      variant="secondary"
      aria-expanded={open}
      aria-controls={open ? controls : undefined}
      onClick={onClick}
    >
      {label}
    </Button>
  );
}

const isLate = (dueAt: string, now = Date.now()) => new Date(dueAt).getTime() < now;

/**
 * The top of the lead page (D-209): the lead's next action is its nearest open task the member may
 * see (`lead.nextTask`), or a nudge to add one. Overdue is said in words, not only in red.
 */
export function NextAction({ lead, onAddTask }: { lead: Lead; onAddTask: () => void }) {
  const next = lead.nextTask ?? null;
  const late = next ? isLate(next.dueAt) : false;
  return (
    <div
      role="group"
      aria-label={tr('הפעולה הבאה')}
      className={cn(
        'flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3',
        late ? 'border-danger-600/40 bg-danger-50' : 'border-surface-border bg-surface-muted',
      )}
    >
      {next ? (
        <div className="flex min-w-0 flex-col gap-1">
          <p className="min-w-0 text-sm text-ink [overflow-wrap:anywhere]">
            <span className="font-semibold">{tr('הפעולה הבאה:')}</span> <bdi>{next.title}</bdi>
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
      ) : (
        <p className="text-sm text-ink-muted">
          {tr('אין פעולה הבאה. כדאי להוסיף משימה כדי לא לשכוח לחזור ללקוח.')}
        </p>
      )}
      <Button type="button" size="sm" variant="secondary" onClick={onAddTask}>
        {tr('+ משימה')}
      </Button>
    </div>
  );
}

const byDue = (a: Task, b: Task) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();

/** The lead's open tasks, nearest first, and "+ משימה" (D-209). */
export function LeadTasksCard({
  lead,
  formOpen,
  onFormOpenChange,
}: {
  lead: Lead;
  formOpen: boolean;
  onFormOpenChange: (open: boolean) => void;
}) {
  const business = useCurrentBusiness();
  const tasks = useTasks(business.id, { leadId: lead.id });
  const [all, setAll] = useState(false);
  const addRef = useRef<HTMLButtonElement>(null);
  const open = (tasks.data ?? []).filter((t) => t.status === 'OPEN').sort(byDue);
  const shown = all ? open : open.slice(0, SUMMARY);
  const listId = `${leadCardId('tasks')}-list`;
  const formId = `${leadCardId('tasks')}-form`;
  const close = () => {
    onFormOpenChange(false);
    addRef.current?.focus();
  };

  return (
    <SideCard
      cardKey="tasks"
      title={tr('משימות')}
      action={
        <AddButton
          label={tr('+ משימה')}
          open={formOpen}
          controls={formId}
          buttonRef={addRef}
          onClick={() => (formOpen ? close() : onFormOpenChange(true))}
        />
      }
    >
      {formOpen && (
        <div id={formId} className="flex flex-col gap-2 rounded-xl bg-surface-muted p-3">
          <NewTaskForm leadId={lead.id} compact autoFocus onCreated={close} />
          <Button type="button" variant="ghost" size="sm" className="self-start" onClick={close}>
            {tr('ביטול')}
          </Button>
        </div>
      )}
      <ListStatus
        query={tasks}
        loading={tr('טוענים את המשימות…')}
        forbidden={tr('אין לך הרשאה לראות את המשימות של הליד הזה.')}
      />
      {tasks.isSuccess &&
        (open.length > 0 ? (
          <ul id={listId} aria-label={tr('משימות הליד')} className="divide-y divide-surface-border">
            {shown.map((t) => (
              <TaskItem key={t.id} task={t} businessId={business.id} showLead={false} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-muted">{tr('אין משימות פתוחות לליד הזה.')}</p>
        ))}
      <ShowAll
        total={tasks.isSuccess ? open.length : 0}
        all={all}
        onToggle={() => setAll((a) => !a)}
        controls={listId}
      />
    </SideCard>
  );
}

/** Upcoming first (nearest first), then past ones (latest first). */
function orderAppointments(list: Appointment[], now: number) {
  const at = (a: Appointment) => new Date(a.startsAt).getTime();
  const upcoming = list.filter((a) => at(a) >= now).sort((a, b) => at(a) - at(b));
  const past = list.filter((a) => at(a) < now).sort((a, b) => at(b) - at(a));
  return [...upcoming, ...past];
}

/** The lead's appointments (last month to two months ahead), nearest first, and "+ תור". */
export function LeadAppointmentsCard({ lead }: { lead: Lead }) {
  const business = useCurrentBusiness();
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  // Fixed once per visit, so the query key stays the same between renders.
  const [range] = useState(() => {
    const now = Date.now();
    return {
      now,
      from: new Date(now - 30 * 86_400_000).toISOString(),
      to: new Date(now + 62 * 86_400_000).toISOString(),
    };
  });
  const appts = useAppointments(business.id, {
    from: range.from,
    to: range.to,
    leadId: lead.id,
  });
  const list = orderAppointments(appts.data ?? [], range.now);
  const shown = all ? list : list.slice(0, SUMMARY);
  const listId = `${leadCardId('appointments')}-list`;

  return (
    <SideCard
      cardKey="appointments"
      title={tr('תורים')}
      action={<AddButton label={tr('+ תור')} onClick={() => setOpen(true)} />}
    >
      <ListStatus
        query={appts}
        loading={tr('טוענים את התורים…')}
        forbidden={tr('אין לך הרשאה לראות את התורים של הליד הזה.')}
      />
      {appts.isSuccess &&
        (list.length > 0 ? (
          <ul id={listId} aria-label={tr('תורי הליד')} className="flex flex-col gap-1.5">
            {shown.map((a) => {
              const past = new Date(a.startsAt).getTime() < range.now;
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
      <ShowAll
        total={appts.isSuccess ? list.length : 0}
        all={all}
        onToggle={() => setAll((a) => !a)}
        controls={listId}
      />
      <NewAppointmentDialog open={open} onOpenChange={setOpen} lead={lead} />
    </SideCard>
  );
}

const newestFirst = (a: Quote, b: Quote) =>
  new Date(b.sentAt ?? b.createdAt).getTime() - new Date(a.sentAt ?? a.createdAt).getTime();

const statusTone: Record<ReturnType<typeof displayStatus>, string> = {
  DRAFT: 'bg-surface-muted text-ink-muted ring-surface-border',
  SENT: 'bg-brand-50 text-brand-800 ring-brand-200',
  ACCEPTED: 'bg-success-50 text-success-600 ring-success-600/30',
  REJECTED: 'bg-danger-50 text-danger-700 ring-danger-600/30',
  EXPIRED: 'bg-warning-50 text-warning-600 ring-warning-600/30',
};

/**
 * The lead's quotes with status and total, newest first, and "+ הצעה" (D-209). The lead's value
 * comes only from here (D-207): won = accepted quotes, open = the latest sent quote still open.
 */
export function LeadQuotesCard({ lead }: { lead: Lead }) {
  const business = useCurrentBusiness();
  const quotes = useQuotes(business.id, { leadId: lead.id });
  const [all, setAll] = useState(false);
  const base = businessWebPaths.section(business.id, 'quotes');
  const list = [...(quotes.data ?? [])].sort(newestFirst);
  const shown = all ? list : list.slice(0, SUMMARY);
  const listId = `${leadCardId('quotes')}-list`;
  const value = lead.value ?? { won: 0, open: 0 };

  return (
    <SideCard
      cardKey="quotes"
      title={tr('הצעות מחיר')}
      action={
        <Link to={`${base}/new?leadId=${lead.id}`} className={buttonClasses('secondary', 'sm')}>
          {tr('+ הצעה')}
        </Link>
      }
    >
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
        query={quotes}
        loading={tr('טוענים את הצעות המחיר…')}
        forbidden={tr('אין לך הרשאה לראות את הצעות המחיר של הליד הזה.')}
      />
      {quotes.isSuccess &&
        (list.length > 0 ? (
          <ul id={listId} aria-label={tr('הצעות המחיר של הליד')} className="flex flex-col gap-1.5">
            {shown.map((q) => {
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
      <ShowAll
        total={quotes.isSuccess ? list.length : 0}
        all={all}
        onToggle={() => setAll((a) => !a)}
        controls={listId}
      />
    </SideCard>
  );
}
