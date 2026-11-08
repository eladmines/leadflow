import {
  businessWebPaths,
  can,
  formatIsraeliPhone,
  replyModeLabels,
  type InboxNumber,
  type ReplyMode,
  type WhatsAppBotResponse,
} from '@leadflow/shared';
import {
  Briefcase,
  CalendarCheck,
  Images,
  MessageCircleReply,
  UserX,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  DialogShell,
  EmptyState,
  RefreshButton,
  Spinner,
  Switch,
} from '../../components/ui';
import { cn } from '../../lib/cn';
import { errorMessage } from '../auth/serverErrors';
import { formatDateTime, timeAgo } from '../leads/api';
import { useCurrentBusiness } from '../shell/CurrentBusiness';
import { NoPermission } from '../shell/NoPermission';
import { PageHeader } from '../shell/PageHeader';
import {
  useBotSettings,
  useUpdateBotSettings,
  useClassifyNumber,
  useForgetPersonal,
  usePersonalNumbers,
  useWhatsAppInbox,
} from './api';
import { AutoReplyCard } from './AutoReplyCard';
import { BookingBotCard, ShowcaseForm, toRequest } from './BookingBotCard';
import { SetupGuide, shouldOfferSetup } from './SetupGuide';
import { tr } from '../../i18n';

/** Phone in local form when it is Israeli, otherwise as received. */
const showPhone = (e164: string) => (e164.startsWith('+972') ? formatIsraeliPhone(e164) : e164);

/** `/b/:businessId/conversations`: WhatsApp numbers waiting to be classified (D-092). */
export function ConversationsPage() {
  const business = useCurrentBusiness();
  if (!can(business.role, 'whatsapp.inbox')) return <NoPermission what={tr('שיחות WhatsApp')} />;
  return <Inbox businessId={business.id} />;
}

const TABS = ['messages', 'auto', 'personal'] as const;
type Tab = (typeof TABS)[number];

/**
 * One page, three tabs (D-129): the messages waiting for you (default), the automatic reply and
 * booking bot settings, and the numbers marked personal. The tab is kept in the address.
 */
function Inbox({ businessId }: { businessId: string }) {
  const inbox = useWhatsAppInbox(businessId);
  const personal = usePersonalNumbers(businessId);
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const tab: Tab = (TABS as readonly string[]).includes(params.get('tab') ?? '')
    ? (params.get('tab') as Tab)
    : 'messages';
  const [done, setDone] = useState<{ name: string; leadId: string | null } | null>(null);
  const waiting = inbox.data?.numbers.length ?? 0;
  const labels: Record<Tab, string> = {
    messages: tr('הודעות'),
    auto: tr('מענה אוטומטי'),
    personal: tr('מספרים פרטיים'),
  };
  const counts: Partial<Record<Tab, number>> = {
    messages: waiting || undefined,
    personal: personal.data?.length || undefined,
  };

  return (
    <section
      aria-label={tr('שיחות WhatsApp')}
      className="overflow-hidden rounded-2xl border border-surface-border bg-surface shadow-card"
    >
      <PageHeader
        inPanel
        title={tr('שיחות WhatsApp')}
        description={tr('הודעות ממספרים חדשים, ותשובה אוטומטית ללקוחות כשאתם עסוקים.')}
        actions={
          <RefreshButton
            onRefresh={() =>
              queryClient.invalidateQueries({ queryKey: ['businesses', businessId, 'whatsapp'] })
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
        {tab === 'messages' && (
          <>
            {done && (
              <Alert tone="success">
                {done.leadId ? (
                  <>
                    {done.name} {tr('נוסף/ה כליד.')}{' '}
                    <Link
                      to={`${businessWebPaths.section(businessId, 'leads')}/${done.leadId}`}
                      className="font-medium underline"
                    >
                      {tr('פתיחת הליד')}
                    </Link>
                  </>
                ) : (
                  tr(
                    '{0} סומן/ה כפרטי. ההודעות נמחקו, והודעות הבאות מהמספר הזה לא ייכנסו למערכת.',
                    done.name,
                  )
                )}
              </Alert>
            )}
            {inbox.isPending ? (
              <Spinner label={tr('טוענים את השיחות…')} />
            ) : inbox.isError ? (
              <Alert tone="danger">{errorMessage(inbox.error)}</Alert>
            ) : !inbox.data.connected && inbox.data.numbers.length === 0 ? (
              <EmptyState
                title={tr('WhatsApp עדיין לא מחובר')}
                description={tr(
                  'אחרי חיבור מספר WhatsApp לעסק, הודעות ממספרים חדשים יופיעו כאן לסיווג.',
                )}
              />
            ) : inbox.data.numbers.length === 0 ? (
              <EmptyState
                title={tr('אין הודעות שמחכות לסיווג')}
                description={tr(
                  'הודעות מלקוחות מוכרים נכנסות ישר לליד שלהם. כשמספר חדש יכתוב, הוא יופיע כאן.',
                )}
              />
            ) : (
              <>
                <p className="text-sm text-ink-muted">
                  {tr('מספרים חדשים שכתבו לכם. החליטו: לקוח (נוצר ליד) או פרטי (ההודעות נמחקות).')}
                </p>
                <ul aria-label={tr('מספרים שמחכים לסיווג')} className="flex flex-col gap-4">
                  {inbox.data.numbers.map((n) => (
                    <li key={n.id}>
                      <NumberCard businessId={businessId} number={n} onDone={setDone} />
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
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
 * The two ways to answer (D-147): automatic reply and the booking bot, each with its own saved
 * settings and an on/off switch. One at a time: turning one on turns the other off.
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
  const turn = (mode: ReplyMode, on: boolean) => {
    const next = on ? mode : 'off';
    update.mutate({ ...toRequest(saved), mode: next, enabled: next === 'booking' });
  };
  return (
    <div role="group" aria-label={tr('מה קורה כשלקוח כותב')} className="flex flex-col gap-4">
      {!connected && (
        <p className="text-sm text-ink-muted">
          {tr('המענה יתחיל לפעול אחרי חיבור מספר WhatsApp לעסק.')}
        </p>
      )}
      <ModeCard
        title={tr(replyModeLabels.auto_reply)}
        description={tr('כל לקוח שכותב מקבל הודעה קצרה, לפי הסטטוס שלך.')}
        icon={MessageCircleReply}
        tone="bg-emerald-500"
        on={saved.mode === 'auto_reply'}
        busy={update.isPending}
        onToggle={(on) => turn('auto_reply', on)}
      >
        <AutoReplyCard businessId={businessId} />
      </ModeCard>
      <ModeCard
        title={tr(replyModeLabels.booking)}
        description={tr('לקוחות רואים זמנים פנויים וקובעים לבד תור או בקשה לאירוע.')}
        icon={CalendarCheck}
        tone="bg-violet-500"
        on={saved.mode === 'booking'}
        busy={update.isPending}
        onToggle={(on) => turn('booking', on)}
      >
        <BookingBotCard businessId={businessId} />
      </ModeCard>
      <ShowcaseCard businessId={businessId} saved={saved} />
      {update.isError && <Alert tone="danger">{errorMessage(update.error)}</Alert>}
    </div>
  );
}

/**
 * "Meanwhile, a look at our work" (D-149): shared by both ways to answer — after the automatic
 * reply, or when a customer doesn't finish booking. Its own switch; the editor is a pop-up.
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
            {tr('אחרי המענה, הלקוח מקבל קישור, תמונות וסרטון מהעסק. לכל היותר פעם ביום.')}
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

function NumberCard({
  businessId,
  number,
  onDone,
}: {
  businessId: string;
  number: InboxNumber;
  onDone: (d: { name: string; leadId: string | null }) => void;
}) {
  const classify = useClassifyNumber(businessId);
  // A Facebook sender (F23) has no phone to show: their name and the channel instead.
  const fb = number.channel === 'messenger';
  const name = number.profileName || (fb ? tr('משתמש/ת פייסבוק') : showPhone(number.phone));
  const act = (as: 'BUSINESS' | 'PERSONAL') =>
    classify.mutate(
      { numberId: number.id, as },
      { onSuccess: (res) => onDone({ name, leadId: res.leadId }) },
    );

  return (
    <Card className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col">
          <h2 className="text-base font-semibold text-ink">{name}</h2>
          <p className="text-sm text-ink-muted">
            {fb ? tr('פייסבוק') : <bdi dir="ltr">{showPhone(number.phone)}</bdi>} ·{' '}
            <time dateTime={number.lastMessageAt} title={formatDateTime(number.lastMessageAt)}>
              {timeAgo(number.lastMessageAt)}
            </time>
          </p>
        </div>
        <div className="flex gap-1.5">
          {fb && (
            <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">
              {tr('פייסבוק')}
            </span>
          )}
          <span className="rounded-full bg-surface-sunken px-2.5 py-1 text-xs font-medium text-ink-muted">
            {tr('לא מסווג')}
          </span>
        </div>
      </header>
      <ol
        aria-label={tr('הודעות מ{0}', name)}
        className="flex max-h-60 flex-col gap-2 overflow-y-auto rounded-xl bg-surface-muted p-3"
      >
        {number.messages.map((m) => (
          <li
            key={m.id}
            className={cn(
              'flex flex-col gap-0.5',
              m.direction === 'OUT' && 'border-s-2 border-success-600/40 ps-2',
            )}
          >
            {m.direction === 'OUT' && (
              <span className="text-xs font-medium text-success-600">
                {m.sender ? tr('נשלחה על ידי {0}', m.sender.name) : tr('תשובה אוטומטית')}
              </span>
            )}
            <p className="whitespace-pre-line break-words text-sm text-ink">{m.body}</p>
            <time dateTime={m.createdAt} className="text-xs text-ink-muted">
              {timeAgo(m.createdAt)}
            </time>
          </li>
        ))}
      </ol>
      {classify.isError && <Alert tone="danger">{errorMessage(classify.error)}</Alert>}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          onClick={() => act('BUSINESS')}
          loading={classify.isPending && classify.variables?.as === 'BUSINESS'}
          disabled={classify.isPending}
        >
          <Briefcase aria-hidden className="h-4 w-4" />
          {tr('עסקי: יצירת ליד')}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => act('PERSONAL')}
          loading={classify.isPending && classify.variables?.as === 'PERSONAL'}
          disabled={classify.isPending}
        >
          <UserX aria-hidden className="h-4 w-4" />
          {tr('פרטי')}
        </Button>
        <p className="text-xs text-ink-muted">
          {tr('פרטי: ההודעות יימחקו, והמספר לא ייכנס למערכת גם בהמשך.')}
        </p>
      </div>
    </Card>
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
