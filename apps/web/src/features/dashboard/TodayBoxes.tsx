import { businessWebPaths, can, type Business } from '@leadflow/shared';
import { CalendarDays, ListTodo, MessageCircle, Users, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '../../lib/cn';
import { intlLocale, tr } from '../../i18n';
import { useAppointments } from '../appointments/api';
import { useLeads } from '../leads/api';
import { groupTasks, useTasks } from '../tasks/api';
import { useWhatsAppInbox } from '../whatsapp/api';

const WEEK_MS = 7 * 86_400_000;

/** Today in the viewer's clock, as an ISO range for the appointments list. */
function today() {
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  const to = new Date(from.getTime() + 86_400_000);
  return { from: from.toISOString(), to: to.toISOString() };
}

interface Box {
  segment: string;
  label: string;
  icon: LucideIcon;
  /** Undefined while loading. */
  value: number | undefined;
  detail: string | null;
  /** Something is waiting for the viewer: the number turns amber. */
  attention: boolean;
}

/**
 * The dashboard's "today" (D-131): only what needs the viewer now — open leads, today's
 * appointments, late tasks and new WhatsApp numbers — each opening its page. Every other section
 * is one click away in the menu.
 */
export function TodayBoxes({ business }: { business: Business }) {
  const id = business.id;
  const canInbox = can(business.role, 'whatsapp.inbox');
  const leads = useLeads(id).data;
  const tasks = useTasks(id, { assigneeId: 'me', status: 'OPEN' }).data;
  const appointments = useAppointments(id, today()).data;
  const inbox = useWhatsAppInbox(id, canInbox).data;

  const now = Date.now();
  const open = leads?.filter((l) => l.stage.kind === 'OPEN');
  const fresh = open?.filter((l) => now - new Date(l.createdAt).getTime() < WEEK_MS).length ?? 0;
  const due = tasks ? groupTasks(tasks) : null;
  const booked = appointments
    ?.filter((a) => a.status !== 'CANCELLED' && a.status !== 'REQUESTED')
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const next = booked?.find((a) => new Date(a.startsAt).getTime() > now);
  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit' });

  const boxes: Box[] = [
    {
      segment: 'leads',
      label: tr('פניות פתוחות'),
      icon: Users,
      value: open?.length,
      detail: fresh ? tr('{0} חדשות השבוע', fresh) : null,
      attention: fresh > 0,
    },
    {
      segment: 'appointments',
      label: tr('תורים היום'),
      icon: CalendarDays,
      value: booked?.length,
      detail: next
        ? tr('הבא ב-{0}', time(next.startsAt))
        : booked?.length
          ? tr('אין עוד תורים היום')
          : null,
      attention: false,
    },
    {
      segment: 'tasks',
      label: tr('משימות באיחור'),
      icon: ListTodo,
      value: due?.overdue.length,
      detail: due?.today.length ? tr('ועוד {0} להיום', due.today.length) : null,
      attention: (due?.overdue.length ?? 0) > 0,
    },
    ...(canInbox
      ? [
          {
            segment: 'conversations',
            label: tr('הודעות ממספרים חדשים'),
            icon: MessageCircle,
            value: inbox?.numbers.length,
            detail: null,
            attention: (inbox?.numbers.length ?? 0) > 0,
          },
        ]
      : []),
  ];
  const loaded = boxes.every((b) => b.value !== undefined);
  const calm = loaded && boxes.every((b) => !b.attention) && !booked?.length;

  return (
    <section aria-labelledby="today-title" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="today-title" className="text-lg font-semibold text-ink">
          {tr('מה מחכה לכם היום')}
        </h2>
        {calm && (
          <p className="text-sm text-ink-muted">{tr('הכול מטופל, אין דברים שמחכים לכם 🎉')}</p>
        )}
      </div>
      <ul
        className={cn(
          'grid grid-cols-1 gap-3 min-[420px]:grid-cols-2',
          boxes.length === 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-3',
        )}
      >
        {boxes.map(({ segment, label, icon: Icon, value, detail, attention }) => (
          <li key={segment}>
            <Link
              to={businessWebPaths.section(id, segment)}
              className="group flex h-full items-start gap-3 rounded-2xl border border-surface-border bg-surface p-4 shadow-card transition hover:border-brand-300 hover:shadow-lift"
            >
              <span
                aria-hidden
                className={cn(
                  'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
                  attention ? 'bg-amber-50 text-amber-700' : 'bg-brand-50 text-brand-700',
                )}
              >
                <Icon className="h-5 w-5" />
              </span>
              <span className="flex min-w-0 flex-col">
                <span
                  className={cn(
                    'text-2xl font-semibold tabular-nums',
                    attention ? 'text-amber-700' : 'text-ink',
                  )}
                >
                  {value ?? '–'}
                </span>
                <span className="text-sm font-medium text-ink group-hover:text-brand-700">
                  {label}
                </span>
                {detail && <span className="text-xs text-ink-muted">{detail}</span>}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
