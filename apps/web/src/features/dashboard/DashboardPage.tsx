import { businessWebPaths, can, roleLabels } from '@leadflow/shared';
import { Link } from 'react-router-dom';
import { buttonClasses } from '../../components/ui';
import { useMe } from '../auth/api';
import { useSite } from '../site/api';
import { useCurrentBusiness } from '../shell/CurrentBusiness';
import { useWhatsAppInbox } from '../whatsapp/api';
import { LeadsOverview } from './LeadsOverview';
import { TodayBoxes } from './TodayBoxes';
import { tr } from '../../i18n';

type ItemState = 'done' | 'todo' | 'soon';

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

/**
 * Business home (D-131): the welcome header — next step and setup progress — and what needs the
 * viewer today. Every section is in the menu.
 */
export function DashboardPage() {
  const business = useCurrentBusiness();
  const me = useMe();
  const user = me.data?.user;
  const site = useSite(business.id).data;
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

      <TodayBoxes business={business} />
      <LeadsOverview />
    </>
  );
}
