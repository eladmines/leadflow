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
import { Card, TextLink } from '../../components/ui';
import { cn } from '../../lib/cn';
import { useMe } from '../auth/api';
import { durationLabel, useReportSummary } from '../reports/api';
import { timeAgo, useLeads } from '../leads/api';
import { useSite } from '../site/api';
import { groupTasks, useTasks } from '../tasks/api';
import { TaskItem } from '../tasks/TaskItem';
import { useCurrentBusiness } from '../shell/CurrentBusiness';
import { useWhatsAppInbox } from '../whatsapp/api';
import { HelpCharacter } from '../tour/HelpCharacter';
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
      tone: { strip: 'bg-sky-500', icon: 'bg-sky-500', note: 'text-sky-700' },
      label: tr('פניות ב־7 הימים האחרונים'),
      value: String(report.leads.current),
      note:
        delta === 0
          ? tr('כמו בשבוע שלפני')
          : tr('{0}{1} לעומת השבוע שלפני', delta > 0 ? '+' : '−', Math.abs(delta)),
    },
    {
      icon: Trophy,
      tone: { strip: 'bg-amber-500', icon: 'bg-amber-500', note: 'text-amber-700' },
      label: tr('יחס סגירה'),
      value: report.closeRate === null ? '—' : `${Math.round(report.closeRate * 100)}%`,
      note: report.closeRate === null ? tr('עוד אין פניות שהוכרעו') : tr('מהפניות של השבוע'),
    },
    {
      icon: Timer,
      tone: { strip: 'bg-violet-500', icon: 'bg-violet-500', note: 'text-violet-700' },
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
          <Card key={s.label} className="relative flex flex-col gap-1 overflow-hidden">
            <span aria-hidden className={cn('absolute inset-x-0 top-0 h-1.5', s.tone.strip)} />
            <span
              aria-hidden
              className={cn(
                'mb-2 flex h-10 w-10 items-center justify-center rounded-full text-white',
                s.tone.icon,
              )}
            >
              <s.icon className="h-5 w-5" />
            </span>
            <span className="text-sm text-ink-muted">{s.label}</span>
            <span className="text-3xl font-bold tabular-nums text-ink">
              <bdi>{s.value}</bdi>
            </span>
            <span className={cn('text-xs font-medium', s.tone.note)}>{s.note}</span>
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
        className="text-brand-100"
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
        className="text-coral-500 transition-[stroke-dashoffset] duration-700"
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
      <circle cx="92" cy="18" r="7" className="fill-coral-400" />
    </svg>
  );
}

function ProfileRow({
  icon: Icon,
  label,
  tone,
  children,
}: {
  icon: LucideIcon;
  label: string;
  /** Icon tile colours (D-111). */
  tone: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', tone)}>
        <Icon aria-hidden className="h-4 w-4" />
      </span>
      <div className="flex min-w-0 flex-col">
        <dt className="text-xs text-ink-muted">{label}</dt>
        <dd className="text-sm text-ink">{children}</dd>
      </div>
    </div>
  );
}

/** A steady colour per person for their initial (decorative; the name is next to it). */
const AVATAR_TONES = [
  'bg-sky-600',
  'bg-amber-600',
  'bg-violet-600',
  'bg-rose-600',
  'bg-emerald-600',
  'bg-orange-600',
];
function avatarTone(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length]!;
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
  const user = useMe().data?.user;
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
    {
      label: tr('אימות כתובת האימייל'),
      hint: tr('כדי שנוכל לשלוח לך התראות על פניות'),
      state: user?.emailVerified ? 'done' : 'todo',
    },
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
      {/* Welcome banner (D-111): blue into the logo's coral, the helper waving hello. The text sits
          on the dark blue side (white text stays readable); decoration is aria-hidden. */}
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-brand-600 via-brand-500 to-coral-500 p-6 text-white shadow-lift rtl:bg-gradient-to-l sm:p-8">
        <span
          aria-hidden
          className="absolute -top-8 end-48 hidden h-28 w-28 rounded-full bg-white/10 sm:block"
        />
        <span
          aria-hidden
          className="absolute -bottom-12 end-8 hidden h-36 w-36 rounded-full bg-amber-300/30 sm:block"
        />
        <span
          aria-hidden
          className="absolute end-72 top-6 hidden h-2.5 w-2.5 rounded-full bg-amber-300 sm:block"
        />
        <span
          aria-hidden
          className="absolute end-32 top-10 hidden h-3 w-3 rotate-45 bg-coral-100 sm:block"
        />
        <div className="relative flex flex-wrap items-center justify-between gap-6">
          <div className="flex items-center gap-5">
            <span className="hidden h-24 w-24 shrink-0 items-center justify-center rounded-full bg-white shadow-md sm:flex">
              <HelpCharacter happy className="h-20 w-20" />
            </span>
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium text-brand-100">
                {business.name} · {tr(roleLabels[business.role])}
              </p>
              <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
                {greeting()}, {firstName}! 👋
              </h1>
              <p className="max-w-md text-base text-brand-50">
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
                    className="mt-2 inline-flex h-10 items-center self-start rounded-xl bg-white px-4 text-sm font-semibold text-brand-700 shadow hover:bg-brand-50 focus-visible:ring-white focus-visible:ring-offset-brand-700"
                  >
                    {next.label === tr('בניית אתר העסק') ? tr('לבניית האתר') : tr('לפרסום האתר')}
                  </Link>
                )}
            </div>
          </div>
          <div
            role="progressbar"
            aria-label={tr('התקדמות ההקמה')}
            aria-valuemin={0}
            aria-valuemax={checklist.length}
            aria-valuenow={done}
            className="relative flex items-center justify-center rounded-2xl bg-white p-2 text-ink shadow-md"
          >
            <ProgressRing done={done} total={checklist.length} />
            <span className="absolute text-lg font-bold text-ink">
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
                    className={cn(
                      'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white',
                      avatarTone(l.contact.name),
                    )}
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
          <ProfileRow icon={Briefcase} tone="bg-sky-100 text-sky-700" label={tr('תחום')}>
            {tr(industryLabels[business.industry])}
          </ProfileRow>
          <ProfileRow icon={Phone} tone="bg-emerald-100 text-emerald-700" label={tr('טלפון')}>
            {business.phone ? (
              <bdi dir="ltr">{formatIsraeliPhone(business.phone)}</bdi>
            ) : (
              tr('לא הוזן')
            )}
          </ProfileRow>
          <ProfileRow icon={MapPin} tone="bg-rose-100 text-rose-700" label={tr('כתובת')}>
            {business.address ?? tr('לא הוזנה')}
          </ProfileRow>
          <ProfileRow icon={Route} tone="bg-amber-100 text-amber-700" label={tr('אזורי שירות')}>
            {business.serviceAreas.length ? business.serviceAreas.join(', ') : tr('לא הוגדרו')}
          </ProfileRow>
          <ProfileRow
            icon={CalendarClock}
            tone="bg-violet-100 text-violet-700"
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
