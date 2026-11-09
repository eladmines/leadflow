import { zodResolver } from '@hookform/resolvers/zod';
import {
  channelsMessages,
  connectWhatsAppRequestSchema,
  type ChannelStatus,
  type ConnectWhatsAppRequest,
} from '@leadflow/shared';
import { Facebook, MessageCircle, Plug } from 'lucide-react';
import { useState } from 'react';
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
  useDisconnect,
  useFacebookPages,
  useFacebookStart,
} from './channelsApi';
import { Section } from './SettingsPage';

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
        </ul>
      )}
      {canEdit && isUuid(facebook) && <PickPage pendingId={facebook!} onClose={clearFacebook} />}
    </Section>
  );
}

function ChannelRow({
  icon: Icon,
  tone,
  title,
  status,
  canEdit,
  onDisconnect,
  disconnecting,
  children,
}: {
  icon: typeof MessageCircle;
  tone: string;
  title: string;
  status: ChannelStatus;
  canEdit: boolean;
  onDisconnect: () => void;
  disconnecting: boolean;
  children?: React.ReactNode;
}) {
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-surface-border p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span
          aria-hidden
          className={cn(
            'flex h-10 w-10 items-center justify-center rounded-xl text-white',
            status.connected ? tone : 'bg-slate-400',
          )}
        >
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-ink">{title}</h3>
          <p className="text-sm text-ink-muted" dir="auto">
            {status.connected
              ? status.source === 'environment'
                ? tr('מחובר דרך הגדרות המערכת')
                : tr('מחובר · {0}', status.name ?? '')
              : tr('לא מחובר')}
          </p>
        </div>
        {canEdit && status.source === 'business' && !confirm && (
          <Button variant="secondary" size="sm" onClick={() => setConfirm(true)}>
            {tr('ניתוק')}
          </Button>
        )}
      </div>
      {confirm && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-surface-muted p-3 text-sm">
          <span className="flex-1 text-ink">
            {tr('לנתק? הודעות חדשות כבר לא יגיעו לתיבת השיחות. השיחות הקיימות נשארות.')}
          </span>
          <Button size="sm" variant="danger" loading={disconnecting} onClick={onDisconnect}>
            {tr('כן, לנתק')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>
            {tr('ביטול')}
          </Button>
        </div>
      )}
      {children}
    </div>
  );
}

function WhatsAppRow({ status, canEdit }: { status: ChannelStatus; canEdit: boolean }) {
  const business = useCurrentBusiness();
  const connect = useConnectWhatsApp(business.id);
  const disconnect = useDisconnect(business.id);
  const [open, setOpen] = useState(false);
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
  return (
    <ChannelRow
      icon={MessageCircle}
      tone="bg-emerald-500"
      title="WhatsApp"
      status={status}
      canEdit={canEdit}
      onDisconnect={() => disconnect.mutate('whatsapp')}
      disconnecting={disconnect.isPending}
    >
      {canEdit && status.source !== 'business' && !open && (
        <Button size="sm" className="self-start" onClick={() => setOpen(true)}>
          {tr('חיבור WhatsApp')}
        </Button>
      )}
      {open && (
        <form noValidate onSubmit={submit} className="flex flex-col gap-3">
          <p className="text-sm text-ink-muted">
            {tr(
              'את הפרטים מוצאים ב-Meta for Developers: האפליקציה של העסק → WhatsApp → API Setup. מעתיקים את ה-Phone number ID ואת טוקן הגישה.',
            )}
          </p>
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
      {disconnect.isError && <Alert tone="danger">{errorMessage(disconnect.error)}</Alert>}
    </ChannelRow>
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
  const disconnect = useDisconnect(business.id);
  return (
    <ChannelRow
      icon={Facebook}
      tone="bg-blue-600"
      title={tr('פייסבוק')}
      status={status}
      canEdit={canEdit}
      onDisconnect={() => disconnect.mutate('messenger')}
      disconnecting={disconnect.isPending}
    >
      {canEdit &&
        status.source !== 'business' &&
        (available ? (
          <Button
            size="sm"
            className="self-start"
            loading={start.isPending}
            onClick={() => start.mutate()}
          >
            {tr('חיבור פייסבוק')}
          </Button>
        ) : (
          <p className="text-sm text-ink-muted">{tr(channelsMessages.facebookUnavailable)}</p>
        ))}
      {start.isError && <Alert tone="danger">{errorMessage(start.error)}</Alert>}
      {disconnect.isError && <Alert tone="danger">{errorMessage(disconnect.error)}</Alert>}
    </ChannelRow>
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
