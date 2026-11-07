import { businessWebPaths, can, type Business } from '@leadflow/shared';
import { Link } from 'react-router-dom';
import { HelpTip } from './HelpTip';
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
  /** "No …", "1 …" or "{n} …" in full words, so the count reads as a sentence. */
  const count = (n: number, none: string | null, one: string, many: string) =>
    n === 0 ? none : n === 1 ? tr(one) : tr(many, n);
  const say = (text: string | null, tone?: 'attention' | 'good') => (text ? { text, tone } : null);
  const openLeads = leads?.filter((l) => l.stage.kind === 'OPEN').length;
  const todayCount = appointments?.filter(
    (a) => a.status !== 'CANCELLED' && a.status !== 'REQUESTED',
  ).length;
  const status: Record<string, { text: string; tone?: 'attention' | 'good' } | null> = {
    site: site
      ? site.published
        ? say(tr('האתר באוויר'), 'good')
        : say(tr('טיוטה — עוד לא פורסם'))
      : say(tr('עוד לא בניתם אתר'), 'attention'),
    leads:
      openLeads === undefined
        ? null
        : say(count(openLeads, tr('אין פניות פתוחות'), 'פנייה פתוחה אחת', '{0} פניות פתוחות')),
    conversations: say(
      count(
        inbox?.numbers.length ?? 0,
        null,
        'מספר חדש אחד מחכה לכם',
        '{0} מספרים חדשים מחכים לכם',
      ),
      'attention',
    ),
    tasks: !due
      ? null
      : due.overdue.length
        ? say(count(due.overdue.length, null, 'משימה אחת באיחור', '{0} משימות באיחור'), 'attention')
        : say(
            count(due.today.length, tr('אין משימות להיום'), 'משימה אחת להיום', '{0} משימות להיום'),
          ),
    appointments:
      todayCount === undefined
        ? null
        : say(count(todayCount, tr('אין תורים היום'), 'תור אחד היום', '{0} תורים היום')),
    quotes: say(count(sent?.length ?? 0, null, 'הצעה אחת מחכה לתשובה', '{0} הצעות מחכות לתשובה')),
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
                    <div
                      className={cn(
                        'group relative flex h-full items-start gap-3 rounded-xl border border-surface-border bg-surface p-4 shadow-card transition focus-within:border-brand-300 hover:border-brand-300 hover:shadow-lift',
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
                      <span className="flex min-w-0 flex-1 flex-col gap-1">
                        <span className="flex flex-wrap items-center gap-1.5">
                          {/* The name is the link, stretched over the whole box. */}
                          <Link
                            to={businessWebPaths.section(id, segment)}
                            className="font-semibold text-ink after:absolute after:inset-0 after:rounded-xl group-hover:text-brand-700 focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:after:ring-2 focus-visible:after:ring-brand-500"
                          >
                            {label}
                          </Link>
                          <HelpTip label={label} text={description} />
                          {comingSoon && (
                            <span className="rounded-md bg-surface-sunken px-1.5 py-0.5 text-[10px] font-medium text-ink-muted">
                              {tr('בקרוב')}
                            </span>
                          )}
                        </span>
                        {s && (
                          <span
                            className={cn(
                              'self-start rounded-full px-2 py-0.5 text-xs font-medium',
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
                    </div>
                  </li>
                );
              })}
          </ul>
        </section>
      ))}
    </div>
  );
}
