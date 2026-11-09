import {
  can,
  formatIsraeliPhone,
  type ReplyMode,
  type WhatsAppBotResponse,
} from '@leadflow/shared';
import { CalendarCheck, Images, MessageCircleReply, type LucideIcon } from 'lucide-react';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  DialogShell,
  EmptyState,
  RefreshButton,
  Spinner,
  Switch,
} from '../../components/ui';
import { cn } from '../../lib/cn';
import { errorMessage } from '../auth/serverErrors';
import { useCurrentBusiness } from '../shell/CurrentBusiness';
import { NoPermission } from '../shell/NoPermission';
import { PageHeader } from '../shell/PageHeader';
import { useBotSettings, useUpdateBotSettings, useForgetPersonal, usePersonalNumbers } from './api';
import { AutoReplyCard } from './AutoReplyCard';
import { BookingBotCard, ShowcaseForm, toRequest } from './BookingBotCard';
import { SetupGuide, shouldOfferSetup } from './SetupGuide';
import { InboxView } from '../conversations/InboxView';
import { refreshInbox, useUnreadConversations } from '../conversations/api';
import { tr } from '../../i18n';

/** Phone in local form when it is Israeli, otherwise as received. */
const showPhone = (e164: string) => (e164.startsWith('+972') ? formatIsraeliPhone(e164) : e164);

/** `/b/:businessId/conversations`: WhatsApp numbers waiting to be classified (D-092). */
export function ConversationsPage() {
  const business = useCurrentBusiness();
  if (!can(business.role, 'whatsapp.inbox')) return <NoPermission what={tr('שיחות')} />;
  return <Inbox businessId={business.id} />;
}

const TABS = ['messages', 'auto', 'personal'] as const;
type Tab = (typeof TABS)[number];

/**
 * One page, three tabs (D-129): the messages waiting for you (default), the automatic reply and
 * booking bot settings, and the numbers marked personal. The tab is kept in the address.
 */
function Inbox({ businessId }: { businessId: string }) {
  const personal = usePersonalNumbers(businessId);
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const tab: Tab = (TABS as readonly string[]).includes(params.get('tab') ?? '')
    ? (params.get('tab') as Tab)
    : 'messages';
  const unread = useUnreadConversations(businessId, true).data?.unreadCount ?? 0;
  const labels: Record<Tab, string> = {
    messages: tr('הודעות'),
    auto: tr('מענה אוטומטי'),
    personal: tr('מספרים פרטיים'),
  };
  const counts: Partial<Record<Tab, number>> = {
    messages: unread || undefined,
    personal: personal.data?.length || undefined,
  };

  return (
    <section
      aria-label={tr('שיחות')}
      className="overflow-hidden rounded-2xl border border-surface-border bg-surface shadow-card"
    >
      <PageHeader
        inPanel
        title={tr('שיחות')}
        description={tr(
          'כל ההודעות מוואטסאפ ומפייסבוק במקום אחד, ותשובה אוטומטית ללקוחות כשאתם עסוקים.',
        )}
        actions={
          <RefreshButton
            onRefresh={() =>
              Promise.all([
                queryClient.invalidateQueries({ queryKey: ['businesses', businessId, 'whatsapp'] }),
                refreshInbox(queryClient, businessId),
              ])
            }
          />
        }
      />
      <div
        role="tablist"
        aria-label={tr('חלקי העמוד')}
        className="flex gap-1 overflow-x-auto border-b border-surface-border px-4 sm:px-5"
      >
        {TABS.map((t) => (
          <button
            key={t}
            id={`tab-${t}`}
            type="button"
            role="tab"
            aria-selected={tab === t}
            aria-controls={`panel-${t}`}
            onClick={() => setParams(t === 'messages' ? {} : { tab: t }, { replace: true })}
            className={cn(
              '-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-sm font-medium transition-colors',
              tab === t
                ? 'border-brand-600 text-brand-700'
                : 'border-transparent text-ink-muted hover:text-ink',
            )}
          >
            {labels[t]}
            {counts[t] && (
              <span
                className={cn(
                  'rounded-full px-1.5 text-xs',
                  t === 'messages'
                    ? 'bg-amber-100 text-amber-800'
                    : 'bg-surface-sunken text-ink-muted',
                )}
              >
                {counts[t]}
              </span>
            )}
          </button>
        ))}
      </div>

      <div
        id={`panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`tab-${tab}`}
        className="flex flex-col gap-4 p-4 sm:p-5"
      >
        {/* F24: every conversation, WhatsApp and Facebook, in one inbox (D-158). */}
        {tab === 'messages' && <InboxView businessId={businessId} />}
        {tab === 'auto' && <AutoTab businessId={businessId} />}
        {tab === 'personal' && <PersonalNumbers businessId={businessId} />}
      </div>
    </section>
  );
}

/** Automatic replies: the step-by-step guide the first time (D-144), then the full settings. */
function AutoTab({ businessId }: { businessId: string }) {
  const bot = useBotSettings(businessId);
  // Decided once, when the settings arrive: open by itself when nothing is set up yet.
  const [guide, setGuide] = useState<boolean | null>(null);
  const ready = bot.isSuccess;
  useEffect(() => {
    if (ready && guide === null) setGuide(shouldOfferSetup(businessId, bot.data!.settings));
  }, [ready, guide, businessId, bot.data]);
  if (bot.isPending || (ready && guide === null)) return <Spinner />;
  const open = guide === true;
  if (open && bot.isSuccess) {
    return (
      <SetupGuide
        businessId={businessId}
        saved={bot.data.settings}
        onClose={() => setGuide(false)}
      />
    );
  }
  if (!bot.isSuccess) return <Alert tone="danger">{errorMessage(bot.error)}</Alert>;
  return (
    <ModeCards businessId={businessId} saved={bot.data.settings} connected={bot.data.connected} />
  );
}

/**
 * One automatic answer (D-166): the status message with "when can we talk?" for every customer,
 * and — when switched on inside it — customers book by themselves. "A peek" follows any decision.
 */
function ModeCards({
  businessId,
  saved,
  connected,
}: {
  businessId: string;
  saved: WhatsAppBotResponse['settings'];
  connected: boolean;
}) {
  const update = useUpdateBotSettings(businessId);
  const on = saved.mode !== 'off';
  const booking = saved.mode === 'booking';
  const setMode = (mode: ReplyMode) =>
    update.mutate({ ...toRequest(saved), mode, enabled: mode === 'booking' });
  const title = tr('מענה אוטומטי');
  return (
    <div role="group" aria-label={tr('מה קורה כשלקוח כותב')} className="flex flex-col gap-4">
      {!connected && (
        <p className="text-sm text-ink-muted">
          {tr('המענה יתחיל לפעול אחרי חיבור מספר WhatsApp לעסק.')}
        </p>
      )}
      <ModeCard
        title={title}
        description={tr('כל לקוח שכותב מקבל הודעה לפי הסטטוס שלך, ובוחר מתי נוח לדבר.')}
        icon={MessageCircleReply}
        tone="bg-emerald-500"
        on={on}
        busy={update.isPending}
        // Off → on comes back the way it was left (booking or not); a new business starts simple.
        onToggle={(next) => setMode(next ? (saved.enabled ? 'booking' : 'auto_reply') : 'off')}
      >
        <AutoReplyCard businessId={businessId} />
        <section
          aria-label={tr('לקוחות קובעים לבד')}
          className="flex flex-col gap-3 rounded-xl border border-surface-border p-4"
        >
          <div className="flex items-start gap-3">
            <span
              className={cn(
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white',
                booking ? 'bg-violet-500' : 'bg-slate-400',
              )}
            >
              <CalendarCheck className="h-4 w-4" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <h4 className="font-medium text-ink">{tr('לקוחות קובעים לבד')}</h4>
              <p className="text-sm text-ink-muted">
                {tr(
                  'מוסיף "לקביעת תור" להודעה: לקוחות רואים זמנים פנויים וקובעים תור או בקשה לאירוע.',
                )}
              </p>
            </div>
            <Switch
              checked={booking}
              label={tr('לקוחות קובעים לבד')}
              disabled={update.isPending}
              onChange={(next) => setMode(next ? 'booking' : 'auto_reply')}
            />
          </div>
          {booking && <BookingBotCard businessId={businessId} />}
        </section>
      </ModeCard>
      <ShowcaseCard businessId={businessId} saved={saved} />
      {update.isError && <Alert tone="danger">{errorMessage(update.error)}</Alert>}
    </div>
  );
}

/**
 * "A peek at the business" (D-149): a link, photos and a video, sent right after the customer
 * decides — a time to talk, a booking, an event request (D-166). Its own switch; editor in a pop-up.
 */
function ShowcaseCard({
  businessId,
  saved,
}: {
  businessId: string;
  saved: WhatsAppBotResponse['settings'];
}) {
  const update = useUpdateBotSettings(businessId);
  const [editing, setEditing] = useState(false);
  const on = saved.showcase.enabled;
  const base = toRequest(saved);
  const title = tr('הצצה לעסק');
  return (
    <section
      aria-label={title}
      className="flex flex-col gap-3 rounded-2xl border border-dashed border-surface-border bg-surface p-4"
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white',
            on ? 'bg-amber-500' : 'bg-slate-400',
          )}
        >
          <Images className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-ink">{title}</h3>
          <p className="text-sm text-ink-muted">
            {tr(
              'מיד אחרי שהלקוח מחליט (זמן לשיחה, תור או אירוע), הוא מקבל קישור, תמונות וסרטון מהעסק. לכל היותר פעם ביום.',
            )}
          </p>
        </div>
        <Switch
          checked={on}
          label={title}
          disabled={update.isPending}
          onChange={(enabled) =>
            update.mutate({ ...base, showcase: { ...base.showcase, enabled } })
          }
        />
      </div>
      <Button variant="secondary" size="sm" className="self-start" onClick={() => setEditing(true)}>
        {tr('עריכת ההצצה')}
      </Button>
      {update.isError && <Alert tone="danger">{errorMessage(update.error)}</Alert>}
      <DialogShell open={editing} onOpenChange={setEditing} title={title} wide>
        <ShowcaseForm businessId={businessId} settings={saved} />
      </DialogShell>
    </section>
  );
}

/** One way to answer: title, switch, and its settings (open when on, or on request). */
function ModeCard({
  title,
  description,
  icon: Icon,
  tone,
  on,
  busy,
  onToggle,
  children,
}: {
  title: string;
  description: string;
  icon: LucideIcon;
  tone: string;
  on: boolean;
  busy: boolean;
  onToggle: (on: boolean) => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const uid = useId();
  const shown = on || open;
  return (
    <section
      aria-labelledby={`${uid}-title`}
      className={cn(
        'flex flex-col gap-4 rounded-2xl border bg-surface p-4',
        on ? 'border-emerald-300' : 'border-surface-border',
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white',
            on ? tone : 'bg-slate-400',
          )}
        >
          <Icon className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h3 id={`${uid}-title`} className="font-semibold text-ink">
            {title}
          </h3>
          <p className="text-sm text-ink-muted">{description}</p>
        </div>
        <Switch checked={on} onChange={onToggle} label={title} disabled={busy} />
      </div>
      {!on && (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="self-start text-sm font-medium text-brand-700 hover:underline"
        >
          {open ? tr('הסתרת ההגדרות') : tr('הגדרות')}
        </button>
      )}
      {shown && children}
    </section>
  );
}

/** Numbers marked personal, with a way to undo the marking. */
function PersonalNumbers({ businessId }: { businessId: string }) {
  const personal = usePersonalNumbers(businessId);
  const forget = useForgetPersonal(businessId);
  if (personal.isPending) return <Spinner label={tr('טוענים…')} />;
  if (personal.isError) return <Alert tone="danger">{errorMessage(personal.error)}</Alert>;
  if (personal.data.length === 0) {
    return (
      <EmptyState
        title={tr('אין מספרים פרטיים')}
        description={tr('מספר שתסמנו כפרטי (חברים, משפחה) יופיע כאן, וההודעות שלו לא יישמרו.')}
      />
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-ink-muted">
        {tr('הודעות מהמספרים האלה לא נשמרות. ביטול הסימון מחזיר את ההודעה הבאה מהמספר לתיבה.')}
      </p>
      {forget.isError && <Alert tone="danger">{errorMessage(forget.error)}</Alert>}
      <ul
        aria-label={tr('מספרים פרטיים')}
        className="divide-y divide-surface-border rounded-xl border border-surface-border"
      >
        {personal.data.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
            {p.channel === 'messenger' ? (
              <span className="text-sm text-ink">
                {tr('משתמש/ת פייסבוק')} · {tr('פייסבוק')}
              </span>
            ) : (
              <bdi dir="ltr" className="text-sm text-ink">
                {showPhone(p.phone)}
              </bdi>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => forget.mutate(p.id)}
              loading={forget.isPending && forget.variables === p.id}
              aria-label={tr(
                'ביטול סימון פרטי ל-{0}',
                p.channel === 'messenger' ? tr('משתמש/ת פייסבוק') : showPhone(p.phone),
              )}
            >
              {tr('ביטול סימון')}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
