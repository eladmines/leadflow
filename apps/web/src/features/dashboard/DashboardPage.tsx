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
  MapPin,
  Phone,
  Route,
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

type ItemState = 'done' | 'todo' | 'soon';

/** Owners/managers: the last 7 days at a glance, from the reports endpoint (F20 lite). */
function WeekStats({ businessId }: { businessId: string }) {
  const report = useReportSummary(businessId, 7).data;
  if (!report) return null;
  const delta = report.leads.current - report.leads.previous;
  const stats = [
    {
      label: 'פניות ב־7 הימים האחרונים',
      value: String(report.leads.current),
      note:
        delta === 0
          ? 'כמו בשבוע שלפני'
          : `${delta > 0 ? '+' : '−'}${Math.abs(delta)} לעומת השבוע שלפני`,
    },
    {
      label: 'יחס סגירה',
      value: report.closeRate === null ? '—' : `${Math.round(report.closeRate * 100)}%`,
      note: report.closeRate === null ? 'עוד אין פניות שהוכרעו' : 'מהפניות של השבוע',
    },
    {
      label: 'זמן תגובה ממוצע',
      value: report.avgResponseMinutes === null ? '—' : durationLabel(report.avgResponseMinutes),
      note: report.avgResponseMinutes === null ? 'עוד לא טופלו פניות' : 'עד הטיפול הראשון',
    },
  ];
  return (
    <section aria-labelledby="week-stats" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="week-stats" className="text-lg font-semibold text-ink">
          השבוע במספרים
        </h2>
        <TextLink to={businessWebPaths.section(businessId, 'reports')}>לכל הדוחות</TextLink>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {stats.map((s) => (
          <Card key={s.label} className="flex flex-col gap-1">
            <span className="text-sm text-ink-muted">{s.label}</span>
            <span className="text-2xl font-semibold tabular-nums text-ink">
              <bdi>{s.value}</bdi>
            </span>
            <span className="text-xs text-ink-muted">{s.note}</span>
          </Card>
        ))}
      </div>
    </section>
  );
}

/** Circular progress (decorative; the accessible value is on the parent progressbar). */
function ProgressRing({ done, total }: { done: number; total: number }) {
  const r = 30;
  const c = 2 * Math.PI * r;
  return (
    <svg aria-hidden viewBox="0 0 72 72" className="h-20 w-20 -rotate-90">
      <circle
        cx="36"
        cy="36"
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth="7"
        className="text-white/70"
      />
      <circle
        cx="36"
        cy="36"
        r={r}
        fill="none"
        strokeWidth="7"
        strokeLinecap="round"
        stroke="currentColor"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - done / total)}
        className="text-accent-500 transition-[stroke-dashoffset] duration-700"
      />
    </svg>
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
      <circle cx="92" cy="18" r="7" className="fill-accent-300" />
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
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-muted text-brand-600">
        <Icon aria-hidden className="h-4 w-4" />
      </span>
      <div className="flex min-w-0 flex-col">
        <dt className="text-xs text-ink-muted">{label}</dt>
        <dd className="text-sm text-ink">{children}</dd>
      </div>
    </div>
  );
}

/** Business home: welcome + setup progress (real state only), recent leads (empty until F07), profile. */
export function DashboardPage() {
  const business = useCurrentBusiness();
  const user = useMe().data?.user;
  const site = useSite(business.id).data;
  const leads = useLeads(business.id).data ?? [];
  const myTasks = groupTasks(
    useTasks(business.id, { assigneeId: 'me', status: 'OPEN' }).data ?? [],
  );
  const urgent = [...myTasks.overdue, ...myTasks.today];
  const firstName = user?.fullName.trim().split(/\s+/)[0] ?? '';

  const checklist: { label: string; hint: string; state: ItemState }[] = [
    {
      label: 'הקמת פרופיל העסק',
      hint: 'שם, תחום, טלפון ושעות פעילות',
      state: business.status === 'ACTIVE' ? 'done' : 'todo',
    },
    {
      label: 'אימות כתובת האימייל',
      hint: 'כדי שנוכל לשלוח לך התראות על פניות',
      state: user?.emailVerified ? 'done' : 'todo',
    },
    {
      label: 'בניית אתר העסק',
      hint: 'בחירת תבנית ועריכת התוכן',
      state: site ? 'done' : 'todo',
    },
    {
      label: 'פרסום האתר',
      hint: 'בחירת כתובת והעלאה לאוויר',
      state: site?.published ? 'done' : 'todo',
    },
    { label: 'חיבור WhatsApp עסקי', hint: 'מענה ללקוחות מתוך המערכת', state: 'soon' },
  ];
  const done = checklist.filter((i) => i.state === 'done').length;
  const next = checklist.find((i) => i.state !== 'done');
  const openDays = business.openingHours
    ? WEEKDAYS.filter((d) => business.openingHours?.[d].open)
    : [];

  return (
    <>
      <section className="relative overflow-hidden rounded-3xl border border-surface-border bg-surface p-6 shadow-card sm:p-8">
        <div className="relative flex flex-wrap items-center justify-between gap-6">
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium text-accent-700">
              {business.name} · {roleLabels[business.role]}
            </p>
            <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
              שלום, {firstName}
            </h1>
            <p className="max-w-md text-base text-ink-muted">
              {next
                ? next.state === 'soon'
                  ? `הצעד הבא: ${next.label} — הכלי הזה יגיע בקרוב.`
                  : `הצעד הבא: ${next.label}.`
                : 'כל הצעדים הושלמו. העסק מוכן לעבודה!'}
            </p>
            {can(business.role, 'site.edit') &&
              (next?.label === 'בניית אתר העסק' || next?.label === 'פרסום האתר') && (
                <Link
                  to={businessWebPaths.section(business.id, 'site')}
                  className={buttonClasses('primary', 'md', 'mt-2 self-start')}
                >
                  {next.label === 'בניית אתר העסק' ? 'לבניית האתר' : 'לפרסום האתר'}
                </Link>
              )}
          </div>
          <div
            role="progressbar"
            aria-label="התקדמות ההקמה"
            aria-valuemin={0}
            aria-valuemax={checklist.length}
            aria-valuenow={done}
            className="relative flex items-center justify-center"
          >
            <ProgressRing done={done} total={checklist.length} />
            <span className="absolute text-lg font-semibold text-ink">
              {done}/{checklist.length}
            </span>
          </div>
        </div>
      </section>

      {can(business.role, 'reports.view') && leads.length > 0 && (
        <WeekStats businessId={business.id} />
      )}

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="flex flex-col gap-5 lg:col-span-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-lg font-semibold text-ink">הצעדים להפעלת העסק</h2>
            <span className="text-sm text-ink-muted">
              הושלמו {done} מתוך {checklist.length}
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
                        ? ' — הושלם'
                        : item.state === 'soon'
                          ? ' — בקרוב'
                          : ' — טרם הושלם'}
                    </span>
                  </p>
                  <p className="text-xs text-ink-muted">{item.hint}</p>
                </div>
                {item.state === 'soon' && (
                  <span className="h-fit rounded-full bg-surface-muted px-2.5 py-1 text-xs text-ink-muted">
                    בקרוב
                  </span>
                )}
              </li>
            ))}
          </ol>
        </Card>

        <Card className="flex flex-col gap-3 lg:col-span-2">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-lg font-semibold text-ink">פניות אחרונות</h2>
            {leads.length > 0 && (
              <TextLink to={businessWebPaths.section(business.id, 'leads')}>לכל הפניות</TextLink>
            )}
          </div>
          {leads.length > 0 ? (
            <ul aria-label="פניות אחרונות" className="flex flex-col divide-y divide-surface-border">
              {leads.slice(0, 5).map((l) => (
                <li key={l.id} className="flex items-center gap-3 py-3">
                  <span
                    aria-hidden
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-100 text-sm font-semibold text-accent-700"
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
                    <p className="truncate text-xs text-ink-muted">{l.message ?? 'ללא הודעה'}</p>
                  </div>
                  <time dateTime={l.createdAt} className="shrink-0 text-xs text-ink-muted">
                    {timeAgo(l.createdAt)}
                  </time>
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 py-6 text-center">
              <EmptyInboxArt />
              <p className="text-base font-medium text-ink">עדיין אין פניות</p>
              <p className="max-w-xs text-sm text-ink-muted">
                אחרי שהאתר יפורסם, כל פנייה מהטופס תופיע כאן ותקבלו עליה התראה.
              </p>
            </div>
          )}
        </Card>
      </div>

      <Card className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-semibold text-ink">
            המשימות שלי להיום
            {myTasks.overdue.length > 0 && (
              <span className="ms-2 rounded-full bg-danger-50 px-2 py-0.5 text-xs font-medium text-danger-600">
                {myTasks.overdue.length} באיחור
              </span>
            )}
          </h2>
          <TextLink to={businessWebPaths.section(business.id, 'tasks')}>לכל המשימות</TextLink>
        </div>
        {urgent.length > 0 ? (
          <ul aria-label="המשימות שלי להיום" className="divide-y divide-surface-border">
            {urgent.slice(0, 6).map((t) => (
              <TaskItem key={t.id} task={t} businessId={business.id} showAssignee={false} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-muted">
            {myTasks.upcoming.length > 0
              ? `אין משימות להיום. ${myTasks.upcoming.length} משימות בהמשך.`
              : 'אין משימות פתוחות. 🎉'}
          </p>
        )}
      </Card>

      <Card className="flex flex-col gap-5">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-semibold text-ink">פרופיל העסק</h2>
          {can(business.role, 'business.update') && (
            <TextLink to={businessWebPaths.section(business.id, 'settings')}>עריכה</TextLink>
          )}
        </div>
        <dl className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <ProfileRow icon={Briefcase} label="תחום">
            {industryLabels[business.industry]}
          </ProfileRow>
          <ProfileRow icon={Phone} label="טלפון">
            {business.phone ? <bdi dir="ltr">{formatIsraeliPhone(business.phone)}</bdi> : 'לא הוזן'}
          </ProfileRow>
          <ProfileRow icon={MapPin} label="כתובת">
            {business.address ?? 'לא הוזנה'}
          </ProfileRow>
          <ProfileRow icon={Route} label="אזורי שירות">
            {business.serviceAreas.length ? business.serviceAreas.join(', ') : 'לא הוגדרו'}
          </ProfileRow>
          <ProfileRow icon={CalendarClock} label="ימי פעילות">
            {openDays.length ? openDays.map((d) => weekdayLabels[d]).join(', ') : 'לא הוגדרו'}
          </ProfileRow>
        </dl>
      </Card>
    </>
  );
}
