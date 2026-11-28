import { can, type ReplyMode, type WhatsAppBotResponse } from '@simplecatch/shared';
import {
  CalendarCheck,
  ChevronDown,
  Images,
  ListOrdered,
  MessageCircle,
  MessageCircleReply,
  type LucideIcon,
} from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { Alert, Spinner, Switch } from '../../components/ui';
import { cn } from '../../lib/cn';
import { useCollapsed } from '../../lib/useCollapsed';
import { errorMessage } from '../auth/serverErrors';
import { useCurrentBusiness } from '../shell/CurrentBusiness';
import { NoPermission } from '../shell/NoPermission';
import { PageHeader } from '../shell/PageHeader';
import { useBotSettings, useUpdateBotSettings } from './api';
import { AutoReplyCard } from './AutoReplyCard';
import { BookingBotCard, ShowcaseForm, toRequest } from './BookingBotCard';
import { QuestionsForm } from './QuestionsEditor';
import { TaskAutomationsCard } from '../tasks/TaskAutomationsCard';
import { tr } from '../../i18n';

type Saved = WhatsAppBotResponse['settings'];

/**
 * `/b/:businessId/automations` (D-175, redesigned as the customer's journey): what happens when a
 * customer writes on WhatsApp, in order: 1 they write, 2 they get the status message, 3 they book by
 * themselves, 4 they get "A peek at the business". The steps hang on a rail (numbered nodes, a
 * line and an arrow between them, dashed towards a step that is off). Each step has one switch, one line saying what it does now, and its settings, folded until asked for.
 */
export function AutomationsPage() {
  const business = useCurrentBusiness();
  // F35: everyone sees the automatic tasks (read-only without `automations.manage`); the WhatsApp
  // journey stays with those who see the inbox.
  if (!can(business.role, 'whatsapp.inbox')) {
    return (
      <div className="flex flex-col gap-5">
        <TaskAutomationsCard />
        <NoPermission what={tr('אוטומציות של וואטסאפ')} />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-5">
      <section
        aria-label={tr('אוטומציות')}
        className="overflow-hidden rounded-2xl border border-surface-border bg-surface shadow-card"
      >
        <PageHeader
          inPanel
          title={tr('אוטומציות')}
          description={tr(
            'מה קורה כשלקוח כותב בוואטסאפ: מענה לפי הסטטוס שלך, קביעת תורים והצצה לעסק.',
          )}
        />
        <div className="flex flex-col gap-5 p-4 sm:p-5">
          <Journey businessId={business.id} />
        </div>
      </section>
      <TaskAutomationsCard />
    </div>
  );
}

function Journey({ businessId }: { businessId: string }) {
  const bot = useBotSettings(businessId);
  if (bot.isPending) return <Spinner />;
  if (!bot.isSuccess) return <Alert tone="danger">{errorMessage(bot.error)}</Alert>;
  return <Steps businessId={businessId} saved={bot.data.settings} connected={bot.data.connected} />;
}

/** What the status message says right now: the active status, or the general message. */
function statusNow(saved: Saved) {
  const active = saved.activeStatus && saved.statuses.find((s) => s.id === saved.activeStatus!.id);
  if (!active) return tr('ההודעה הכללית');
  return active.preset ? tr(active.label) : active.label;
}

function Steps({
  businessId,
  saved,
  connected,
}: {
  businessId: string;
  saved: Saved;
  connected: boolean;
}) {
  const update = useUpdateBotSettings(businessId);
  const auto = saved.mode !== 'off';
  const booking = saved.mode === 'booking';
  const peek = saved.showcase.enabled;
  // The questions step (D-198): on only inside the status answer, and only when the switch is on.
  const asking = auto && saved.questionsEnabled;
  const count = saved.questions.length;
  const setMode = (mode: ReplyMode) =>
    update.mutate({ ...toRequest(saved), mode, enabled: mode === 'booking' });
  const base = toRequest(saved);
  const files = saved.showcase.assetIds.length + (saved.showcase.video ? 1 : 0);

  return (
    <>
      {!connected && (
        <Alert tone="info">{tr('המענה יתחיל לפעול אחרי חיבור מספר WhatsApp לעסק.')}</Alert>
      )}
      <ol aria-label={tr('מה קורה כשלקוח כותב')} className="flex flex-col gap-6">
        <FlowStep
          n={1}
          icon={MessageCircle}
          tone="bg-slate-500"
          title={tr('הלקוח כותב')}
          description={tr('כל הודעה בוואטסאפ למספר העסק מתחילה את התהליך.')}
          nextOff={!auto}
        />
        <FlowStep
          n={2}
          icon={MessageCircleReply}
          tone="bg-emerald-500"
          title={tr('הודעה לפי הסטטוס')}
          description={tr('הלקוח מקבל הודעה לפי הסטטוס שלך, ובוחר מתי נוח לדבר.')}
          on={auto}
          busy={update.isPending}
          // Off → on comes back the way it was left (booking or not); a new business starts simple.
          onToggle={(next) => setMode(next ? (saved.enabled ? 'booking' : 'auto_reply') : 'off')}
          now={
            auto ? tr('עכשיו: {0}', statusNow(saved)) : tr('כבוי: הלקוח לא מקבל הודעה אוטומטית.')
          }
          settingsLabel={tr('הגדרות הסטטוס וההודעה')}
          settings={<AutoReplyCard businessId={businessId} />}
          nextOff={!asking}
        />
        <FlowStep
          n={3}
          icon={ListOrdered}
          tone="bg-sky-500"
          title={tr('שאלות ללקוח')}
          description={tr(
            'אחרי ההודעה הבוט שואל את הלקוח את השאלות שלכם, אחת אחרי השנייה, ומחכה לתשובה לפני הבאה. את כל התשובות אתם מקבלים במשימה ובהערה בליד.',
          )}
          on={asking}
          busy={update.isPending}
          disabled={!auto}
          disabledNote={tr('פועל רק כשהמענה לפי הסטטוס דלוק.')}
          // Only the switch is sent: the written questions stay as they are, on or off.
          onToggle={(next) => update.mutate({ ...toRequest(saved), questionsEnabled: next })}
          now={
            !saved.questionsEnabled
              ? tr('כבוי: הלקוח לא נשאל. השאלות שכתבתם נשמרות.')
              : count
                ? tr('{0} שאלות, אחת אחרי השנייה', String(count))
                : tr('עוד לא כתבתם שאלות. כתבו אותן בהגדרות.')
          }
          settingsLabel={tr('עריכת השאלות')}
          settings={<QuestionsForm businessId={businessId} saved={saved} />}
          nextOff={!booking}
        />
        <FlowStep
          n={4}
          icon={CalendarCheck}
          tone="bg-violet-500"
          title={tr('לקוחות קובעים לבד')}
          description={tr('מוסיף "לקביעת תור" להודעה: הלקוח רואה זמנים פנויים וקובע תור או הזמנה.')}
          on={booking}
          busy={update.isPending}
          disabled={!auto}
          disabledNote={tr('פועל רק כשהמענה לפי הסטטוס דלוק.')}
          onToggle={(next) => setMode(next ? 'booking' : 'auto_reply')}
          now={
            booking
              ? tr(
                  '{0} · אישור: {1}',
                  saved.flow === 'event' ? tr('הזמנות') : tr('תורים'),
                  saved.autoConfirm ? tr('מיד') : tr('ידני'),
                )
              : tr('כבוי: אפשר לקבוע רק מול הצוות.')
          }
          settingsLabel={tr('הגדרות קביעת התורים')}
          settings={<BookingBotCard businessId={businessId} />}
          nextOff={!peek}
        />
        <FlowStep
          n={5}
          icon={Images}
          tone="bg-amber-500"
          title={tr('הצצה לעסק')}
          description={tr(
            'מיד אחרי שהלקוח מחליט (זמן לשיחה, תור או הזמנה), הוא מקבל קישור, תמונות וסרטון מהעסק. לכל היותר פעם ביום.',
          )}
          on={peek}
          busy={update.isPending}
          onToggle={(enabled) =>
            update.mutate({ ...base, showcase: { ...base.showcase, enabled } })
          }
          now={
            peek
              ? tr('{0} · {1} קבצים', saved.showcase.link ? tr('עם קישור') : tr('בלי קישור'), files)
              : tr('כבוי.')
          }
          settingsLabel={tr('עריכת ההצצה')}
          settings={<ShowcaseForm businessId={businessId} settings={saved} />}
          last
        />
      </ol>
      {update.isError && <Alert tone="danger">{errorMessage(update.error)}</Alert>}
    </>
  );
}

/**
 * One step of the journey: a number, what happens, a switch (when it can be turned off), a line on
 * what it does now, and its settings, folded until "settings" is pressed (remembered per step).
 */
function FlowStep({
  n,
  icon: Icon,
  tone,
  title,
  description,
  on,
  busy = false,
  disabled = false,
  disabledNote,
  onToggle,
  now,
  settingsLabel,
  settings,
  nextOff,
  last = false,
}: {
  n: number;
  icon: LucideIcon;
  tone: string;
  title: string;
  description: string;
  /** Undefined: a step with no switch (the customer writing). */
  on?: boolean;
  busy?: boolean;
  disabled?: boolean;
  disabledNote?: string;
  onToggle?: (on: boolean) => void;
  now?: string;
  settingsLabel?: string;
  settings?: ReactNode;
  /** The step after this one is off: the line to it is dashed (the customer skips it). */
  nextOff?: boolean;
  last?: boolean;
}) {
  const uid = useId();
  const [folded, toggle] = useCollapsed(`automations-step-${n}`, true);
  const live = on === undefined || on;
  return (
    <li className="relative ps-12">
      {/* The rail: a numbered node, and a line with an arrow down to the next step. */}
      <span
        aria-hidden
        className={cn(
          'absolute start-0 top-4 flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold ring-4 ring-surface',
          live ? 'bg-brand-600 text-white' : 'bg-slate-200 text-ink-muted',
        )}
      >
        {n}
      </span>
      {!last && (
        <>
          <span
            aria-hidden
            className={cn(
              'absolute start-[15px] top-12 -bottom-[2.2rem] border-s-2',
              nextOff ? 'border-dashed border-slate-300' : 'border-brand-300',
            )}
          />
          <ChevronDown
            aria-hidden
            className={cn(
              'absolute start-[7px] -bottom-[2.6rem] h-4 w-4',
              nextOff ? 'text-slate-300' : 'text-brand-300',
            )}
          />
        </>
      )}
      <section
        aria-labelledby={`${uid}-title`}
        className={cn(
          'flex flex-col gap-3 rounded-2xl border bg-surface p-4',
          on ? 'border-emerald-300' : 'border-surface-border',
        )}
      >
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white',
              live ? tone : 'bg-slate-400',
            )}
          >
            <Icon className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 id={`${uid}-title`} className="font-semibold text-ink">
              {title}
            </h3>
            <p className="text-sm text-ink-muted">{description}</p>
            {now && <p className="mt-1 text-sm font-medium text-ink">{now}</p>}
            {disabled && disabledNote && (
              <p className="mt-1 text-xs text-ink-muted">{disabledNote}</p>
            )}
          </div>
          {on !== undefined && onToggle && (
            <Switch checked={on} onChange={onToggle} label={title} disabled={busy || disabled} />
          )}
        </div>
        {settings && (
          <>
            <button
              type="button"
              aria-expanded={!folded}
              aria-controls={`${uid}-settings`}
              onClick={toggle}
              className="inline-flex items-center gap-1 self-start rounded-lg text-sm font-medium text-brand-700 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-brand-400"
            >
              {folded ? settingsLabel : tr('הסתרת ההגדרות')}
              <ChevronDown
                aria-hidden
                className={cn(
                  'h-4 w-4 transition-transform motion-reduce:transition-none',
                  !folded && 'rotate-180',
                )}
              />
            </button>
            {!folded && (
              <div id={`${uid}-settings`} className="flex flex-col gap-4">
                {settings}
              </div>
            )}
          </>
        )}
      </section>
    </li>
  );
}
