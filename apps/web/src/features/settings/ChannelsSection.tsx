import { zodResolver } from '@hookform/resolvers/zod';
import {
  can,
  channelsMessages,
  connectWhatsAppRequestSchema,
  type Channel,
  type ChannelStatus,
  type ConnectWhatsAppRequest,
} from '@leadflow/shared';
import {
  Check,
  ChevronLeft,
  Copy,
  ExternalLink,
  Facebook,
  Instagram,
  Mail,
  MessageCircle,
  Plug,
  Unplug,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { useSearchParams } from 'react-router-dom';
import { Alert, Button, DialogShell, Field, PasswordField, Spinner } from '../../components/ui';
import { cn } from '../../lib/cn';
import { tr } from '../../i18n';
import { applyServerErrors, errorMessage } from '../auth/serverErrors';
import { useCurrentBusiness } from '../shell/CurrentBusiness';
import {
  useChannels,
  useConnectFacebook,
  useConnectWhatsApp,
  useCreateEmailAddress,
  useDisconnect,
  useFacebookPages,
  useFacebookStart,
} from './channelsApi';
import { Section } from './SettingsPage';
import { PersonalNumbers } from '../whatsapp/PersonalNumbers';
import { usePersonalNumbers } from '../whatsapp/api';

/** What came back from Facebook's sign-in (`?facebook=`): a sign-in to finish, or why not. */
const FACEBOOK_RESULTS: Record<string, string> = {
  cancelled: 'החיבור לפייסבוק בוטל.',
  error: channelsMessages.facebookFailed,
  'no-pages': channelsMessages.noPages,
};
const isUuid = (v: string | null) => Boolean(v && /^[0-9a-f-]{36}$/i.test(v));

/**
 * F25 (D-159): each business connects its own WhatsApp number and Facebook Page. Messages reach
 * the inbox once connected. Everyone sees the status; only the owner connects or disconnects.
 */
export function ChannelsSection({ canEdit }: { canEdit: boolean }) {
  const business = useCurrentBusiness();
  const channels = useChannels(business.id);
  const [params, setParams] = useSearchParams();
  const facebook = params.get('facebook');
  const clearFacebook = () =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        next.delete('facebook');
        return next;
      },
      { replace: true },
    );

  return (
    <Section
      title={tr('ערוצים')}
      description={tr('חברו את הוואטסאפ ואת דף הפייסבוק של העסק, וכל ההודעות יגיעו לתיבת השיחות.')}
      icon={Plug}
      tone="bg-emerald-500"
    >
      {facebook && FACEBOOK_RESULTS[facebook] && (
        <Alert tone="warning">{tr(FACEBOOK_RESULTS[facebook]!)}</Alert>
      )}
      {channels.isPending ? (
        <Spinner size="sm" label={tr('טוענים…')} />
      ) : channels.isError ? (
        <Alert tone="danger">{errorMessage(channels.error)}</Alert>
      ) : (
        <ul className="flex flex-col gap-3">
          <li>
            <WhatsAppRow status={channels.data.whatsapp} canEdit={canEdit} />
          </li>
          <li>
            <FacebookRow
              status={channels.data.messenger}
              canEdit={canEdit}
              available={channels.data.facebookLogin}
            />
          </li>
          {/* Not connectable yet (UI only, D-160). */}
          <li>
            <ComingSoonRow
              icon={Instagram}
              tone="bg-pink-500"
              title="Instagram"
              description={tr(
                'הודעות ישירות מאינסטגרם יגיעו לתיבת השיחות. החשבון מתחבר דרך דף הפייסבוק של העסק.',
              )}
            />
          </li>
          <li>
            <EmailRow
              status={channels.data.email}
              canEdit={canEdit}
              available={channels.data.emailInbound}
            />
          </li>
        </ul>
      )}
      {canEdit && isUuid(facebook) && <PickPage pendingId={facebook!} onClose={clearFacebook} />}
    </Section>
  );
}

type BoxState = 'connected' | 'off' | 'soon';

const STATE_PILL: Record<BoxState, { label: string; className: string }> = {
  connected: { label: 'מחובר', className: 'bg-emerald-50 text-emerald-700' },
  off: { label: 'לא מחובר', className: 'bg-slate-100 text-slate-600' },
  soon: { label: 'בקרוב', className: 'bg-amber-50 text-amber-700' },
};

/**
 * The connect / disconnect control (a button with role="switch"): the plug is in the socket when
 * the channel is connected and pulled out when it isn't. The words beside it say the same, so the
 * colour is never the only signal.
 */
function PlugSwitch({
  title,
  connected,
  onToggle,
  disabled,
  busy,
  hideLabel,
}: {
  title: string;
  connected: boolean;
  onToggle: () => void;
  disabled?: boolean;
  busy?: boolean;
  /** For a channel that isn't available yet: just the (disabled) plug. */
  hideLabel?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={connected}
      aria-label={title}
      aria-busy={busy || undefined}
      disabled={disabled || busy}
      onClick={onToggle}
      className="group inline-flex items-center gap-2 rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <span
        aria-hidden
        className={cn(
          'relative inline-flex h-8 w-14 shrink-0 items-center rounded-full transition-colors',
          connected ? 'bg-emerald-500' : 'bg-slate-300',
        )}
      >
        <span
          className={cn(
            'flex h-6 w-6 items-center justify-center rounded-full bg-white shadow transition-transform',
            connected
              ? 'text-emerald-600 ltr:translate-x-7 rtl:-translate-x-7'
              : 'text-slate-500 ltr:translate-x-1 rtl:-translate-x-1',
          )}
        >
          {connected ? <Plug className="h-3.5 w-3.5" /> : <Unplug className="h-3.5 w-3.5" />}
        </span>
      </span>
      {!hideLabel && (
        <span
          aria-hidden
          className={cn('text-sm font-medium', connected ? 'text-emerald-700' : 'text-ink-muted')}
        >
          {connected ? tr('מחובר') : tr('לא מחובר')}
        </span>
      )}
    </button>
  );
}

/**
 * One box per channel, the same for every channel (D-161): its icon in its colour, the name with a
 * status pill, what it does, the connected number or Page, and the main button on the same side.
 * Forms and confirmations open below, inside the box.
 */
function ChannelBox({
  icon: Icon,
  tone,
  title,
  description,
  state,
  detail,
  action,
  children,
}: {
  icon: typeof MessageCircle;
  tone: string;
  title: string;
  description: string;
  state: BoxState;
  /** When connected: the number or the Page's name. */
  detail?: string | null;
  action?: ReactNode;
  children?: ReactNode;
}) {
  const pill = STATE_PILL[state];
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-surface-border p-4">
      <div className="flex flex-wrap items-start gap-3">
        <span
          aria-hidden
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white',
            tone,
          )}
        >
          <Icon className="h-5 w-5" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h3 className="flex flex-wrap items-center gap-2 font-semibold text-ink">
            {title}
            {state === 'soon' && (
              <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', pill.className)}>
                {tr(pill.label)}
              </span>
            )}
          </h3>
          <p className="text-sm text-ink-muted">{description}</p>
          {state === 'connected' && detail && (
            <p className="text-sm font-medium text-ink" dir="auto">
              {detail}
            </p>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children}
    </div>
  );
}

/** Turning the plug off asks for a short confirmation inside the box. */
function useDisconnectFlow(channel: Channel) {
  const business = useCurrentBusiness();
  const disconnect = useDisconnect(business.id);
  const [confirm, setConfirm] = useState(false);
  const panel = (
    <>
      {confirm && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-surface-muted p-3 text-sm">
          <span className="flex-1 text-ink">
            {tr('לנתק? הודעות חדשות כבר לא יגיעו לתיבת השיחות. השיחות הקיימות נשארות.')}
          </span>
          <Button
            size="sm"
            variant="danger"
            loading={disconnect.isPending}
            onClick={() => disconnect.mutate(channel, { onSuccess: () => setConfirm(false) })}
          >
            {tr('כן, לנתק')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>
            {tr('ביטול')}
          </Button>
        </div>
      )}
      {disconnect.isError && <Alert tone="danger">{errorMessage(disconnect.error)}</Alert>}
    </>
  );
  return { request: () => setConfirm(true), panel };
}

const stateOf = (status: ChannelStatus): BoxState => (status.connected ? 'connected' : 'off');
const detailOf = (status: ChannelStatus) =>
  status.source === 'environment' ? tr('דרך הגדרות המערכת') : status.name;

const META_APPS_URL = 'https://developers.facebook.com/apps';
const META_GUIDE_URL = 'https://developers.facebook.com/docs/whatsapp/cloud-api/get-started';
const META_SYSTEM_USERS_URL = 'https://business.facebook.com/settings/system-users';

function GuideLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline"
    >
      <bdi dir="ltr">{children}</bdi>
      <ExternalLink aria-hidden className="h-3.5 w-3.5 shrink-0" />
    </a>
  );
}

/** Where the two details come from, step by step (opens by itself: most owners need it). */
function WhatsAppGuide() {
  return (
    <details open className="rounded-lg bg-surface-muted p-3 text-sm text-ink-muted">
      <summary className="cursor-pointer font-medium text-ink">
        {tr('איך משיגים את הפרטים?')}
      </summary>
      <ol className="mt-2 flex list-decimal flex-col gap-2 ps-5">
        <li>
          {tr('נכנסים ל-')}
          <GuideLink href={META_APPS_URL}>Meta for Developers</GuideLink>
          {tr(', פותחים את האפליקציה של העסק (או יוצרים אחת) ומוסיפים אליה את המוצר WhatsApp.')}
        </li>
        <li>{tr('ב-WhatsApp ← API Setup מעתיקים את ה-Phone number ID של המספר.')}</li>
        <li>
          {tr('לטוקן קבוע: ב-')}
          <GuideLink href={META_SYSTEM_USERS_URL}>Business Settings → System users</GuideLink>
          {tr(
            ' יוצרים משתמש מערכת, משייכים לו את האפליקציה ויוצרים טוקן עם ההרשאות whatsapp_business_messaging ו-whatsapp_business_management.',
          )}
        </li>
      </ol>
      <p className="mt-2">
        {tr('הטוקן הזמני שמופיע ב-API Setup פג אחרי 24 שעות, ואז החיבור מפסיק לעבוד.')}
      </p>
      <p className="mt-2">
        <GuideLink href={META_GUIDE_URL}>{tr('המדריך המלא של Meta')}</GuideLink>
      </p>
    </details>
  );
}

function WhatsAppRow({ status, canEdit }: { status: ChannelStatus; canEdit: boolean }) {
  const business = useCurrentBusiness();
  const connect = useConnectWhatsApp(business.id);
  const off = useDisconnectFlow('whatsapp');
  const [open, setOpen] = useState(false);
  const [showPersonal, setShowPersonal] = useState(false);
  const seesPersonal = can(business.role, 'whatsapp.inbox');
  const personal = usePersonalNumbers(business.id, seesPersonal);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<ConnectWhatsAppRequest>({
    resolver: zodResolver(connectWhatsAppRequestSchema),
    defaultValues: { phoneNumberId: '', accessToken: '' },
  });
  const submit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await connect.mutateAsync(values);
      setOpen(false);
      form.reset();
    } catch (err) {
      setFormError(applyServerErrors(err, form.setError, ['phoneNumberId', 'accessToken']));
    }
  });
  const errors = form.formState.errors;
  const action = (
    <PlugSwitch
      title="WhatsApp"
      connected={status.connected}
      disabled={!canEdit || status.source === 'environment'}
      onToggle={() => (status.connected ? off.request() : setOpen((o) => !o))}
    />
  );
  return (
    <ChannelBox
      icon={MessageCircle}
      tone="bg-emerald-500"
      title="WhatsApp"
      description={tr(
        'הודעות מלקוחות בוואטסאפ יגיעו לתיבת השיחות, ושם גם המענה האוטומטי וקביעת התורים.',
      )}
      state={stateOf(status)}
      detail={detailOf(status)}
      action={action}
    >
      {off.panel}
      {/* Numbers marked personal live with the WhatsApp connection (D-175). */}
      {seesPersonal && personal.data && personal.data.length > 0 && (
        <button
          type="button"
          onClick={() => setShowPersonal(true)}
          className="inline-flex items-center gap-1 self-start text-sm font-medium text-brand-700 hover:underline"
        >
          {tr('מספרים פרטיים')}
          {` (${personal.data.length})`}
          <ChevronLeft aria-hidden className="h-4 w-4 ltr:rotate-180" />
        </button>
      )}
      <DialogShell open={showPersonal} onOpenChange={setShowPersonal} title={tr('מספרים פרטיים')}>
        <PersonalNumbers businessId={business.id} />
      </DialogShell>
      {open && (
        <form noValidate onSubmit={submit} className="flex flex-col gap-3">
          <WhatsAppGuide />
          {formError && <Alert tone="danger">{formError}</Alert>}
          <Field
            label="Phone number ID"
            dir="ltr"
            inputMode="numeric"
            autoComplete="off"
            error={errors.phoneNumberId?.message}
            {...form.register('phoneNumberId')}
          />
          <PasswordField
            label={tr('טוקן גישה')}
            dir="ltr"
            autoComplete="off"
            hint={tr('נשמר מוצפן, ולא מוצג שוב.')}
            error={errors.accessToken?.message}
            {...form.register('accessToken')}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" loading={form.formState.isSubmitting}>
              {tr('חיבור')}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
              {tr('ביטול')}
            </Button>
          </div>
        </form>
      )}
    </ChannelBox>
  );
}

/**
 * F27 (D-177): the business's forwarding address. Mail sent to it lands in the inbox, and replies
 * go out from the same address. Created with one click; shown with a copy button.
 */
function EmailRow({
  status,
  canEdit,
  available,
}: {
  status: ChannelStatus;
  canEdit: boolean;
  available: boolean;
}) {
  const business = useCurrentBusiness();
  const create = useCreateEmailAddress(business.id);
  const off = useDisconnectFlow('email');
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(status.name ?? '');
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // No clipboard access (an insecure page): the address is on screen to copy by hand.
    }
  };
  const action = (
    <PlugSwitch
      title={tr('אימייל')}
      connected={status.connected}
      disabled={!canEdit || (!status.connected && !available)}
      busy={create.isPending}
      onToggle={() => (status.connected ? off.request() : create.mutate())}
    />
  );
  return (
    <ChannelBox
      icon={Mail}
      tone="bg-sky-500"
      title={tr('אימייל')}
      description={tr(
        'לכל עסק כתובת משלו. מיילים שנשלחים אליה מגיעים לתיבת השיחות, והתשובות יוצאות ממנה.',
      )}
      state={stateOf(status)}
      action={action}
    >
      {status.connected && status.name && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-surface-muted p-3">
          <bdi dir="ltr" className="flex-1 break-all text-sm font-medium text-ink">
            {status.name}
          </bdi>
          <Button type="button" size="sm" variant="secondary" onClick={copy}>
            {copied ? (
              <Check aria-hidden className="h-4 w-4" />
            ) : (
              <Copy aria-hidden className="h-4 w-4" />
            )}
            {copied ? tr('הועתק') : tr('העתקה')}
          </Button>
        </div>
      )}
      {status.connected && (
        <p className="text-sm text-ink-muted">
          {tr('אפשר לשים אותה באתר ובחתימה, או להעביר אליה מיילים מהתיבה הרגילה.')}
        </p>
      )}
      {off.panel}
      {canEdit && !available && !status.connected && (
        <p className="text-sm text-ink-muted">{tr(channelsMessages.emailUnavailable)}</p>
      )}
      {create.isError && <Alert tone="danger">{errorMessage(create.error)}</Alert>}
    </ChannelBox>
  );
}

function FacebookRow({
  status,
  canEdit,
  available,
}: {
  status: ChannelStatus;
  canEdit: boolean;
  available: boolean;
}) {
  const business = useCurrentBusiness();
  const start = useFacebookStart(business.id);
  const off = useDisconnectFlow('messenger');
  const action = (
    <PlugSwitch
      title={tr('פייסבוק')}
      connected={status.connected}
      disabled={!canEdit || status.source === 'environment' || (!status.connected && !available)}
      busy={start.isPending}
      onToggle={() => (status.connected ? off.request() : start.mutate())}
    />
  );
  return (
    <ChannelBox
      icon={Facebook}
      tone="bg-blue-600"
      title={tr('פייסבוק')}
      description={tr('הודעות לדף הפייסבוק של העסק יגיעו לתיבת השיחות, ותוכלו לענות להם משם.')}
      state={stateOf(status)}
      detail={detailOf(status)}
      action={action}
    >
      {off.panel}
      {canEdit && !available && status.source !== 'business' && (
        <p className="text-sm text-ink-muted">{tr(channelsMessages.facebookUnavailable)}</p>
      )}
      {start.isError && <Alert tone="danger">{errorMessage(start.error)}</Alert>}
    </ChannelBox>
  );
}

/** A channel on its way (D-160): the same box, its button not active yet. */
function ComingSoonRow(props: {
  icon: typeof MessageCircle;
  tone: string;
  title: string;
  description: string;
}) {
  return (
    <ChannelBox
      {...props}
      state="soon"
      action={
        <PlugSwitch title={props.title} connected={false} disabled hideLabel onToggle={() => {}} />
      }
    />
  );
}

/** Back from Facebook: choose which of the person's Pages to connect. */
function PickPage({ pendingId, onClose }: { pendingId: string; onClose: () => void }) {
  const business = useCurrentBusiness();
  const pages = useFacebookPages(business.id, pendingId);
  const connect = useConnectFacebook(business.id);
  const [pageId, setPageId] = useState<string | null>(null);
  const chosen = pageId ?? pages.data?.pages[0]?.id ?? null;
  return (
    <DialogShell open onOpenChange={(o) => !o && onClose()} title={tr('איזה דף לחבר?')}>
      {pages.isPending ? (
        <Spinner size="sm" label={tr('טוענים את הדפים…')} />
      ) : pages.isError ? (
        <Alert tone="danger">{errorMessage(pages.error)}</Alert>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (chosen) connect.mutate({ pendingId, pageId: chosen }, { onSuccess: onClose });
          }}
        >
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm text-ink-muted">
              {tr('ההודעות לדף הזה יגיעו לתיבת השיחות של העסק.')}
            </legend>
            {pages.data.pages.map((p) => (
              <label
                key={p.id}
                className={cn(
                  'flex cursor-pointer items-center gap-3 rounded-xl border p-3',
                  chosen === p.id ? 'border-brand-600 bg-brand-50' : 'border-surface-border',
                )}
              >
                <input
                  type="radio"
                  name="facebook-page"
                  checked={chosen === p.id}
                  onChange={() => setPageId(p.id)}
                  className="h-4 w-4 accent-brand-600"
                />
                <span className="font-medium text-ink" dir="auto">
                  {p.name}
                </span>
              </label>
            ))}
          </fieldset>
          {connect.isError && <Alert tone="danger">{errorMessage(connect.error)}</Alert>}
          <Button type="submit" loading={connect.isPending} disabled={!chosen}>
            {tr('חיבור הדף')}
          </Button>
        </form>
      )}
    </DialogShell>
  );
}
