import { can, type ReplyMode, type WhatsAppBotResponse } from '@leadflow/shared';
import { CalendarCheck, Images, MessageCircleReply, type LucideIcon } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { Alert, Button, DialogShell, Spinner, Switch } from '../../components/ui';
import { cn } from '../../lib/cn';
import { errorMessage } from '../auth/serverErrors';
import { useCurrentBusiness } from '../shell/CurrentBusiness';
import { NoPermission } from '../shell/NoPermission';
import { PageHeader } from '../shell/PageHeader';
import { useBotSettings, useUpdateBotSettings } from './api';
import { AutoReplyCard } from './AutoReplyCard';
import { BookingBotCard, ShowcaseForm, toRequest } from './BookingBotCard';
import { tr } from '../../i18n';

/**
 * `/b/:businessId/automations` (D-175): the automatic answer — status, booking, "A peek" — on its
 * own page, so Conversations is only the inbox.
 */
export function AutomationsPage() {
  const business = useCurrentBusiness();
  if (!can(business.role, 'whatsapp.inbox')) return <NoPermission what={tr('אוטומציות')} />;
  return (
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
      <div className="flex flex-col gap-4 p-4 sm:p-5">
        <AutoTab businessId={business.id} />
      </div>
    </section>
  );
}

/** The automatic answer's settings (D-166). */
function AutoTab({ businessId }: { businessId: string }) {
  const bot = useBotSettings(businessId);
  if (bot.isPending) return <Spinner />;
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
