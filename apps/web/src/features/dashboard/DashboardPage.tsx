import {
  businessWebPaths,
  can,
  formatIsraeliPhone,
  industryLabels,
  roleLabels,
  weekdayLabels,
  WEEKDAYS,
} from '@leadflow/shared';
import {
  Briefcase,
  CalendarClock,
  Check,
  Clock,
  Inbox,
  MapPin,
  Phone,
  Route,
  Timer,
  Trophy,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { buttonClasses, Card, TextLink } from '../../components/ui';
import { cn } from '../../lib/cn';
import { useMe } from '../auth/api';
import { durationLabel, useReportSummary } from '../reports/api';
import { timeAgo, useLeads } from '../leads/api';
import { useSite } from '../site/api';
import { groupTasks, useTasks } from '../tasks/api';
import { TaskItem } from '../tasks/TaskItem';
import { useCurrentBusiness } from '../shell/CurrentBusiness';
import { useWhatsAppInbox } from '../whatsapp/api';
import { FeatureTiles } from './FeatureTiles';
import { stageTone } from '../leads/LeadsPage';
import { tr } from '../../i18n';

type ItemState = 'done' | 'todo' | 'soon';

/** Owners/managers: the last 7 days at a glance, from the reports endpoint (F20 lite). */
function WeekStats({ businessId }: { businessId: string }) {
  const report = useReportSummary(businessId, 7).data;
  if (!report) return null;
  const delta = report.leads.current - report.leads.previous;
  const stats = [
    {
      icon: Inbox,
      tone: 'bg-sky-50 text-sky-700',
      label: tr('פניות ב־7 הימים האחרונים'),
      value: String(report.leads.current),
      note:
        delta === 0
          ? tr('כמו בשבוע שלפני')
          : tr('{0}{1} לעומת השבוע שלפני', delta > 0 ? '+' : '−', Math.abs(delta)),
    },
    {
      icon: Trophy,
      tone: 'bg-amber-50 text-amber-700',
      label: tr('יחס סגירה'),
      value: report.closeRate === null ? '—' : `${Math.round(report.closeRate * 100)}%`,
      note: report.closeRate === null ? tr('עוד אין פניות שהוכרעו') : tr('מהפניות של השבוע'),
    },
    {
      icon: Timer,
      tone: 'bg-violet-50 text-violet-700',
      label: tr('זמן תגובה ממוצע'),
      value: report.avgResponseMinutes === null ? '—' : durationLabel(report.avgResponseMinutes),
      note: report.avgResponseMinutes === null ? tr('עוד לא טופלו פניות') : tr('עד הטיפול הראשון'),
    },
  ];
  return (
    <section aria-labelledby="week-stats" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="week-stats" className="text-lg font-semibold text-ink">
          {tr('השבוע במספרים')}
        </h2>
        <TextLink to={businessWebPaths.section(businessId, 'reports')}>{tr('לכל הדוחות')}</TextLink>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {stats.map((s) => (
          <Card key={s.label} className="flex items-start gap-4">
            <span
              aria-hidden
              className={cn(
                'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
                s.tone,
              )}
            >
              <s.icon className="h-5 w-5" />
            </span>
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-sm text-ink-muted">{s.label}</span>
              <span className="text-2xl font-semibold tabular-nums text-ink">
                <bdi>{s.value}</bdi>
              </span>
              <span className="text-xs text-ink-muted">{s.note}</span>
            </div>
          </Card>
        ))}
      </div>
    </section>
  );
}

/** Friendly empty-inbox illustration (inline SVG, no external assets). */
function EmptyInboxArt() {
  return (
    <svg aria-hidden viewBox="0 0 120 90" className="h-24 w-32">
      <ellipse cx="60" cy="82" rx="42" ry="5" className="fill-surface-sunken" />
      <rect
        x="22"
        y="22"
        width="76"
        height="52"
        rx="12"
        className="fill-brand-50 stroke-brand-200"
        strokeWidth="2"
      />
      <path
        d="M22 50h22l6 10h20l6-10h22"
        className="fill-none stroke-brand-300"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <rect
        x="38"
        y="10"
        width="44"
        height="28"
        rx="6"
        className="fill-surface stroke-surface-border"
        strokeWidth="2"
      />
      <path
        d="M46 20h28M46 28h18"
        className="stroke-brand-200"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <circle cx="92" cy="18" r="7" className="fill-brand-200" />
    </svg>
  );
}

function ProfileRow({
  icon: Icon,
  label,
  children,
}: {
  icon: LucideIcon;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
        <Icon aria-hidden className="h-4 w-4" />
      </span>
      <div className="flex min-w-0 flex-col">
        <dt className="text-xs text-ink-muted">{label}</dt>
        <dd className="text-sm text-ink">{children}</dd>
      </div>
    </div>
  );
}

/**
 * Greeting by the viewer's local time. Late at night stays "ערב טוב": in Hebrew "לילה טוב" is said
 * when leaving, not when arriving.
 */
export function greeting(now = new Date()): string {
  const hour = now.getHours();
  if (hour >= 5 && hour < 12) return tr('בוקר טוב');
  if (hour >= 12 && hour < 17) return tr('צהריים טובים');
  return tr('ערב טוב');
}

/** Business home: welcome + setup progress (real state only), recent leads (empty until F07), profile. */
export function DashboardPage() {
  const business = useCurrentBusiness();
  const me = useMe();
  const user = me.data?.user;
  const site = useSite(business.id).data;
  const leads = useLeads(business.id).data ?? [];
  const myTasks = groupTasks(
    useTasks(business.id, { assigneeId: 'me', status: 'OPEN' }).data ?? [],
  );
  const urgent = [...myTasks.overdue, ...myTasks.today];
  const firstName = user?.fullName.trim().split(/\s+/)[0] ?? '';
  // Only owners/managers can ask about the WhatsApp connection (D-092).
  const whatsappConnected =
    useWhatsAppInbox(business.id, can(business.role, 'whatsapp.inbox')).data?.connected ?? false;

  const checklist: { label: string; hint: string; state: ItemState }[] = [
    {
      label: tr('הקמת פרופיל העסק'),
      hint: tr('שם, תחום, טלפון ושעות פעילות'),
      state: business.status === 'ACTIVE' ? 'done' : 'todo',
    },
    // Not a step while the server sends no email (D-122).
    ...(me.data?.emailVerification === false
      ? []
      : [
          {
            label: tr('אימות כתובת האימייל'),
            hint: tr('כדי שנוכל לשלוח לך התראות על פניות'),
            state: (user?.emailVerified ? 'done' : 'todo') as ItemState,
          },
        ]),
    {
      label: tr('בניית אתר העסק'),
      hint: tr('בחירת תבנית ועריכת התוכן'),
      state: site ? 'done' : 'todo',
    },
    {
      label: tr('פרסום האתר'),
      hint: tr('בחירת כתובת והעלאה לאוויר'),
      state: site?.published ? 'done' : 'todo',
    },
    // Connected numbers are set up with LeadFlow for now (D-091); a self-service screen comes later.
    whatsappConnected
      ? {
          label: tr('חיבור WhatsApp עסקי'),
          hint: tr('מחובר: הודעות מוואטסאפ נכנסות כלידים'),
          state: 'done',
        }
      : {
          label: tr('חיבור WhatsApp עסקי'),
          hint: tr('מענה ללקוחות מתוך המערכת. חיבור עצמי יגיע בקרוב'),
          state: 'soon',
        },
  ];
  const done = checklist.filter((i) => i.state === 'done').length;
  const next = checklist.find((i) => i.state !== 'done');
  const openDays = business.openingHours
    ? WEEKDAYS.filter((d) => business.openingHours?.[d].open)
    : [];

  return (
    <>
      {/* Welcome header (D-113): a light card, dark text, a faint blue glow; progress as a slim bar. */}
      <section className="relative overflow-hidden rounded-2xl border border-surface-border bg-surface p-6 shadow-card sm:p-8">
        <span
          aria-hidden
          className="absolute -end-24 -top-24 h-64 w-64 rounded-full bg-brand-100/70 blur-3xl"
        />
        <div className="relative flex flex-wrap items-end justify-between gap-6">
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium text-brand-700">
              <bdi>{business.name}</bdi> · {tr(roleLabels[business.role])}
            </p>
            <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
              {greeting()}, <bdi>{firstName}</bdi>
            </h1>
            <p className="max-w-md text-base text-ink-muted">
              {next
                ? next.state === 'soon'
                  ? tr('הצעד הבא: {0} — הכלי הזה יגיע בקרוב.', next.label)
                  : tr('הצעד הבא: {0}.', next.label)
                : tr('כל הצעדים הושלמו. העסק מוכן לעבודה!')}
            </p>
            {can(business.role, 'site.edit') &&
              (next?.label === tr('בניית אתר העסק') || next?.label === tr('פרסום האתר')) && (
                <Link
                  to={businessWebPaths.section(business.id, 'site')}
                  className={buttonClasses('primary', 'md', 'mt-2 self-start')}
                >
                  {next.label === tr('בניית אתר העסק') ? tr('לבניית האתר') : tr('לפרסום האתר')}
                </Link>
              )}
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-56">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="text-ink-muted">{tr('התקדמות ההקמה')}</span>
              <span className="font-semibold tabular-nums text-ink">
                <bdi>
                  {done}/{checklist.length}
                </bdi>
              </span>
            </div>
            <div
              role="progressbar"
              aria-label={tr('התקדמות ההקמה')}
              aria-valuemin={0}
              aria-valuemax={checklist.length}
              aria-valuenow={done}
              className="h-2 overflow-hidden rounded-full bg-brand-100"
            >
              <div
                className="h-full rounded-full bg-brand-600 transition-[width] duration-700"
                style={{ width: `${(done / checklist.length) * 100}%` }}
              />
            </div>
          </div>
        </div>
      </section>

      <FeatureTiles business={business} />

      {can(business.role, 'reports.view') && leads.length > 0 && (
        <WeekStats businessId={business.id} />
      )}

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="flex flex-col gap-5 lg:col-span-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-lg font-semibold text-ink">{tr('הצעדים להפעלת העסק')}</h2>
            <span className="text-sm text-ink-muted">
              {tr('הושלמו')} {done} {tr('מתוך')} {checklist.length}
            </span>
          </div>
          <ol className="flex flex-col">
            {checklist.map((item, i) => (
              <li key={item.label} className="relative flex gap-4 pb-5 last:pb-0">
                {i < checklist.length - 1 && (
                  <span
                    aria-hidden
                    className={cn(
                      'absolute start-[15px] top-8 h-[calc(100%-2rem)] w-0.5 rounded-full',
                      item.state === 'done' ? 'bg-brand-200' : 'bg-surface-border',
                    )}
                  />
                )}
                <span
                  aria-hidden
                  className={cn(
                    'relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold',
                    item.state === 'done' && 'bg-brand-600 text-white',
                    item.state === 'todo' && 'bg-accent-100 text-accent-700 ring-4 ring-accent-50',
                    item.state === 'soon' && 'bg-surface-muted text-ink-subtle',
                  )}
                >
                  {item.state === 'done' ? (
                    <Check className="h-4 w-4" strokeWidth={3} />
                  ) : item.state === 'soon' ? (
                    <Clock className="h-4 w-4" />
                  ) : (
                    i + 1
                  )}
                </span>
                <div className="flex flex-1 flex-col pt-1">
                  <p
                    className={cn(
                      'text-sm font-medium',
                      item.state === 'soon' ? 'text-ink-muted' : 'text-ink',
                      item.state === 'done' && 'text-ink-muted',
                    )}
                  >
                    {item.label}
                    <span className="sr-only">
                      {item.state === 'done'
                        ? tr(' — הושלם')
                        : item.state === 'soon'
                          ? tr(' — בקרוב')
                          : tr(' — טרם הושלם')}
                    </span>
                  </p>
                  <p className="text-xs text-ink-muted">{item.hint}</p>
                </div>
                {item.state === 'soon' && (
                  <span className="h-fit rounded-full bg-surface-muted px-2.5 py-1 text-xs text-ink-muted">
                    {tr('בקרוב')}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </Card>

        <Card className="flex flex-col gap-3 lg:col-span-2">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-lg font-semibold text-ink">{tr('פניות אחרונות')}</h2>
            {leads.length > 0 && (
              <TextLink to={businessWebPaths.section(business.id, 'leads')}>
                {tr('לכל הפניות')}
              </TextLink>
            )}
          </div>
          {leads.length > 0 ? (
            <ul
              aria-label={tr('פניות אחרונות')}
              className="flex flex-col divide-y divide-surface-border"
            >
              {leads.slice(0, 5).map((l) => (
                <li key={l.id} className="flex items-center gap-3 py-3">
                  <span
                    aria-hidden
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-50 text-sm font-semibold text-brand-700"
                  >
                    {l.contact.name.trim().charAt(0)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">
                      <Link
                        to={`${businessWebPaths.section(business.id, 'leads')}/${l.id}`}
                        className="hover:underline"
                      >
                        {l.contact.name}
                      </Link>
                    </p>
                    <p className="truncate text-xs text-ink-muted">
                      {l.message ?? tr('ללא הודעה')}
                    </p>
                  </div>
                  <span
                    className={cn(
                      'hidden shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium sm:inline',
                      stageTone[l.stage.kind],
                    )}
                  >
                    {tr(l.stage.name)}
                  </span>
                  <time dateTime={l.createdAt} className="shrink-0 text-xs text-ink-muted">
                    {timeAgo(l.createdAt)}
                  </time>
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 py-6 text-center">
              <EmptyInboxArt />
              <p className="text-base font-medium text-ink">{tr('עדיין אין פניות')}</p>
              <p className="max-w-xs text-sm text-ink-muted">
                {tr('אחרי שהאתר יפורסם, כל פנייה מהטופס תופיע כאן ותקבלו עליה התראה.')}
              </p>
            </div>
          )}
        </Card>
      </div>

      <Card className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-semibold text-ink">
            {tr('המשימות שלי להיום')}
            {myTasks.overdue.length > 0 && (
              <span className="ms-2 rounded-full bg-danger-50 px-2 py-0.5 text-xs font-medium text-danger-600">
                {myTasks.overdue.length} {tr('באיחור')}
              </span>
            )}
          </h2>
          <TextLink to={businessWebPaths.section(business.id, 'tasks')}>
            {tr('לכל המשימות')}
          </TextLink>
        </div>
        {urgent.length > 0 ? (
          <ul aria-label={tr('המשימות שלי להיום')} className="divide-y divide-surface-border">
            {urgent.slice(0, 6).map((t) => (
              <TaskItem key={t.id} task={t} businessId={business.id} showAssignee={false} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-muted">
            {myTasks.upcoming.length > 0
              ? tr('אין משימות להיום. {0} משימות בהמשך.', myTasks.upcoming.length)
              : tr('אין משימות פתוחות. 🎉')}
          </p>
        )}
      </Card>

      <Card className="flex flex-col gap-5">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-semibold text-ink">{tr('פרופיל העסק')}</h2>
          {can(business.role, 'business.update') && (
            <TextLink to={businessWebPaths.section(business.id, 'settings')}>
              {tr('עריכה')}
            </TextLink>
          )}
        </div>
        <dl className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <ProfileRow icon={Briefcase} label={tr('תחום')}>
            {tr(industryLabels[business.industry])}
          </ProfileRow>
          <ProfileRow icon={Phone} label={tr('טלפון')}>
            {business.phone ? (
              <bdi dir="ltr">{formatIsraeliPhone(business.phone)}</bdi>
            ) : (
              tr('לא הוזן')
            )}
          </ProfileRow>
          <ProfileRow icon={MapPin} label={tr('כתובת')}>
            {business.address ?? tr('לא הוזנה')}
          </ProfileRow>
          <ProfileRow icon={Route} label={tr('אזורי שירות')}>
            {business.serviceAreas.length ? business.serviceAreas.join(', ') : tr('לא הוגדרו')}
          </ProfileRow>
          <ProfileRow
            icon={CalendarClock}

            label={tr('ימי פעילות')}
          >
            {openDays.length
              ? openDays.map((d) => tr(weekdayLabels[d])).join(', ')
              : tr('לא הוגדרו')}
          </ProfileRow>
        </dl>
      </Card>
    </>
  );
}
