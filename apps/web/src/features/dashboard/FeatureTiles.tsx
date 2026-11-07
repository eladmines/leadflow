import { businessWebPaths, can, type Business } from '@leadflow/shared';
import { Link } from 'react-router-dom';
import { cn } from '../../lib/cn';
import { tr } from '../../i18n';
import { useAppointments } from '../appointments/api';
import { useLeads } from '../leads/api';
import { useQuotes } from '../quotes/api';
import { useSite } from '../site/api';
import { navGroupLabels, navItems, type NavGroup } from '../shell/nav';
import { groupTasks, useTasks } from '../tasks/api';
import { useWhatsAppInbox } from '../whatsapp/api';

/** Today in the viewer's clock, as an ISO range for the appointments list. */
function today() {
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  const to = new Date(from.getTime() + 86_400_000);
  return { from: from.toISOString(), to: to.toISOString() };
}

/**
 * The dashboard's way into every section (D-124): a box for each menu item, in the sidebar's
 * groups, with its colour, a line about it, and a live count where one helps ("3 for today").
 * Only the sections this role can open; "coming soon" ones are marked.
 */
export function FeatureTiles({ business }: { business: Business }) {
  const id = business.id;
  const leads = useLeads(id).data;
  const site = useSite(id).data;
  const tasks = useTasks(id, { assigneeId: 'me', status: 'OPEN' }).data;
  const inbox = useWhatsAppInbox(id, can(business.role, 'whatsapp.inbox')).data;
  const range = today();
  const appointments = useAppointments(id, range).data;
  const sent = useQuotes(id, { status: 'SENT' }).data;

  const due = tasks ? groupTasks(tasks) : null;
  const status: Record<string, { text: string; tone?: 'attention' | 'good' } | null> = {
    site: site
      ? site.published
        ? { text: tr('באוויר'), tone: 'good' }
        : { text: tr('טיוטה') }
      : { text: tr('עוד לא נבנה'), tone: 'attention' },
    leads: leads
      ? { text: tr('{0} פתוחות', leads.filter((l) => l.stage.kind === 'OPEN').length) }
      : null,
    conversations: inbox?.numbers.length
      ? { text: tr('{0} מחכים לסיווג', inbox.numbers.length), tone: 'attention' }
      : null,
    tasks: due
      ? due.overdue.length
        ? { text: tr('{0} באיחור', due.overdue.length), tone: 'attention' }
        : { text: tr('{0} להיום', due.today.length) }
      : null,
    appointments: appointments
      ? {
          text: tr(
            '{0} היום',
            appointments.filter((a) => a.status !== 'CANCELLED' && a.status !== 'REQUESTED').length,
          ),
        }
      : null,
    quotes: sent?.length ? { text: tr('{0} מחכות לתשובה', sent.length) } : null,
  };

  const items = navItems.filter(
    (i) => i.segment && (!i.permission || can(business.role, i.permission)),
  );
  const groups = [...new Set(items.map((i) => i.group))].filter(Boolean) as NavGroup[];

  return (
    <div className="flex flex-col gap-5">
      {groups.map((group) => (
        <section key={group} aria-labelledby={`tiles-${group}`} className="flex flex-col gap-2.5">
          <h2
            id={`tiles-${group}`}
            className="text-xs font-semibold uppercase tracking-wider text-ink-subtle"
          >
            {navGroupLabels[group]}
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {items
              .filter((i) => i.group === group)
              .map(({ segment, label, description, icon: Icon, tone, comingSoon }) => {
                const s = status[segment];
                return (
                  <li key={segment}>
                    <Link
                      to={businessWebPaths.section(id, segment)}
                      className={cn(
                        'group flex h-full items-start gap-3 rounded-xl border border-surface-border bg-surface p-4 shadow-card transition hover:border-brand-300 hover:shadow-lift',
                        comingSoon && 'opacity-70',
                      )}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-white',
                          tone,
                        )}
                      >
                        <Icon className="h-5 w-5" />
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-ink group-hover:text-brand-700">
                            {label}
                          </span>
                          {comingSoon && (
                            <span className="rounded-md bg-surface-sunken px-1.5 py-0.5 text-[10px] font-medium text-ink-muted">
                              {tr('בקרוב')}
                            </span>
                          )}
                        </span>
                        <span className="text-sm text-ink-muted">{description}</span>
                        {s && (
                          <span
                            className={cn(
                              'mt-1.5 self-start rounded-full px-2 py-0.5 text-xs font-medium',
                              s.tone === 'attention'
                                ? 'bg-amber-50 text-amber-800'
                                : s.tone === 'good'
                                  ? 'bg-emerald-50 text-emerald-700'
                                  : 'bg-surface-sunken text-ink-muted',
                            )}
                          >
                            {s.text}
                          </span>
                        )}
                      </span>
                    </Link>
                  </li>
                );
              })}
          </ul>
        </section>
      ))}
    </div>
  );
}
