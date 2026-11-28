import {
  sendWhatsAppRequestSchema,
  whatsappMessages,
  whatsappStatusLabels,
  type Channel,
  type SendWhatsAppRequest,
} from '@simplecatch/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { Bot, MessageCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { useScrollToLatest } from '../../lib/useScrollToLatest';
import { Alert, Button, Card, Spinner, Textarea } from '../../components/ui';
import { cn } from '../../lib/cn';
import { errorMessage } from '../auth/serverErrors';
import { formatDateTime, timeAgo } from '../leads/api';
import { useCurrentBusiness } from '../shell/CurrentBusiness';
import { usePauseBot, useSendWhatsApp, useWhatsAppThread } from './api';
import { tr, intlLocale } from '../../i18n';
import { messageBody } from '../../lib/messageBody';

const timeFmt = new Intl.DateTimeFormat(intlLocale(), { hour: '2-digit', minute: '2-digit' });

/** The reply box, so the lead page's WhatsApp button can put the cursor there. */
export const WHATSAPP_REPLY_ID = 'whatsapp-reply';

/** The channel's name, as the lead page's sub-tabs and the conversation heading show it. */
export function channelName(channel: Channel) {
  return channel === 'email'
    ? tr('אימייל')
    : channel === 'messenger'
      ? 'Facebook Messenger'
      : channel === 'instagram'
        ? 'Instagram'
        : 'WhatsApp';
}

const listNames: Record<Channel, string> = {
  whatsapp: 'שיחת וואטסאפ',
  email: 'שיחת מייל',
  messenger: 'שיחת פייסבוק',
  instagram: 'שיחת אינסטגרם',
};

const emptyTexts: Record<Channel, string> = {
  whatsapp: 'אין שיחת וואטסאפ עם הליד.',
  email: 'אין עדיין מיילים עם הליד.',
  messenger: 'אין שיחת פייסבוק עם הליד.',
  instagram: 'אין שיחת אינסטגרם עם הליד.',
};

/**
 * The conversation with the lead's contact (F12, F23, F27, F28). On the lead page's "תקשורת" tab
 * (D-221) it shows one channel's messages; the reply box is in the channel the customer wrote in
 * last (where the server sends a reply). `action` is how to start elsewhere (wa.me, mailto).
 */
export function WhatsAppThread({
  leadId,
  channel,
  action,
}: {
  leadId: string;
  /** Only this channel's messages; none = the whole conversation. */
  channel?: Channel;
  action?: ReactNode;
}) {
  const business = useCurrentBusiness();
  const thread = useWhatsAppThread(business.id, leadId);
  const listRef = useScrollToLatest<HTMLOListElement>(thread.data?.messages.at(-1)?.id);
  const send = useSendWhatsApp(business.id, leadId);
  const pause = usePauseBot(business.id, leadId);
  const form = useForm<SendWhatsAppRequest>({
    resolver: zodResolver(sendWhatsAppRequestSchema),
    defaultValues: { text: '' },
  });
  const submit = form.handleSubmit((v) => send.mutate(v, { onSuccess: () => form.reset() }));

  if (thread.isPending) {
    return (
      <Card>
        <Spinner size="sm" label={tr('טוענים את השיחה…')} />
      </Card>
    );
  }
  if (thread.isError) {
    return (
      <Card className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-ink">{channelName(channel ?? 'whatsapp')}</h2>
        <Alert tone="danger">{errorMessage(thread.error)}</Alert>
      </Card>
    );
  }
  const { connected, replyUntil, botPaused } = thread.data;
  // Where a reply goes: the channel of the customer's last message.
  const replyChannel = thread.data.channel ?? 'whatsapp';
  const view = channel ?? replyChannel;
  const messages = channel
    ? thread.data.messages.filter((m) => (m.channel ?? 'whatsapp') === channel)
    : thread.data.messages;
  // A Facebook Messenger conversation (F23): replies go there; no booking bot.
  const fb = view === 'messenger';
  // An Instagram conversation (F28): the same, through Instagram.
  const ig = view === 'instagram';
  // An email conversation (F27): replies go out by email, with no 24-hour window or booking bot.
  const mail = view === 'email';
  const title = channelName(view);
  // Replies only go to the channel the customer wrote in last.
  const replyHere = connected && view === replyChannel;
  const elsewhere = connected && view !== replyChannel && thread.data.messages.length > 0;
  // Its own tab on the lead page, so say why it's empty rather than show nothing.
  if (messages.length === 0 && !replyHere) {
    return (
      <Card className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-ink">{title}</h2>
        <p className="text-sm text-ink-muted">
          {tr(emptyTexts[view])}{' '}
          {view === 'whatsapp' &&
            !connected &&
            tr('אחרי חיבור מספר WhatsApp לעסק, ההודעות יופיעו כאן.')}
        </p>
        {action}
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-ink">
          <MessageCircle
            aria-hidden
            className={cn(
              'h-5 w-5',
              mail
                ? 'text-sky-600'
                : fb
                  ? 'text-blue-600'
                  : ig
                    ? 'text-pink-600'
                    : 'text-success-600',
            )}
          />
          {title}
        </h2>
        {connected && view === 'whatsapp' && (
          // The booking bot for this customer only (D-108): pause it to talk yourself.
          <div className="flex items-center gap-2 text-xs text-ink-muted">
            <Bot aria-hidden className="h-4 w-4" />
            <span>{botPaused ? tr('הבוט מושהה בשיחה הזו') : tr('הבוט יכול לענות בשיחה הזו')}</span>
            <Button
              size="sm"
              variant="secondary"
              loading={pause.isPending}
              onClick={() => pause.mutate(!botPaused)}
            >
              {botPaused ? tr('הפעלת הבוט') : tr('השהיית הבוט')}
            </Button>
          </div>
        )}
      </div>
      {pause.isError && <Alert tone="danger">{errorMessage(pause.error)}</Alert>}
      {messages.length === 0 ? (
        <p className="text-sm text-ink-muted">
          {mail
            ? tr('עדיין אין מיילים. כשהלקוח יכתוב לעסק במייל, השיחה תופיע כאן.')
            : tr('עדיין אין הודעות. כשהלקוח יכתוב לעסק בוואטסאפ, השיחה תופיע כאן.')}
        </p>
      ) : (
        <ol
          ref={listRef}
          aria-label={tr(listNames[view])}
          // Its own scroll box, at most half the screen, so the reply box stays in view.
          className="scrollbar-visible flex max-h-[min(28rem,50dvh)] flex-col gap-2 overflow-y-auto overscroll-contain"
        >
          {messages.map((m) => {
            const out = m.direction === 'OUT';
            return (
              <li key={m.id} className={cn('flex', out ? 'justify-end' : 'justify-start')}>
                <div
                  className={cn(
                    'flex max-w-[85%] flex-col gap-1 rounded-2xl px-3.5 py-2 text-sm',
                    out
                      ? 'rounded-ee-sm bg-success-50 text-ink ring-1 ring-success-600/20'
                      : 'rounded-es-sm bg-surface-muted text-ink',
                  )}
                >
                  <span className="sr-only">
                    {out
                      ? tr('נשלחה{0}:', m.sender ? tr(' על ידי {0}', m.sender.name) : '')
                      : tr('הלקוח כתב:')}
                  </span>
                  {m.subject && <p className="text-xs font-semibold">{m.subject}</p>}
                  <p className="whitespace-pre-line break-words">{messageBody(m.body)}</p>
                  <p className="flex items-center gap-1.5 text-xs text-ink-muted">
                    <time dateTime={m.createdAt} title={formatDateTime(m.createdAt)}>
                      {timeAgo(m.createdAt)}
                    </time>
                    {out && !m.sender && (
                      // On Facebook nothing answers automatically: it was written on the Page.
                      <span>
                        ·{' '}
                        {ig
                          ? tr('נשלחה מאינסטגרם')
                          : fb
                            ? tr('נשלחה מדף הפייסבוק')
                            : tr('תשובה אוטומטית')}
                      </span>
                    )}
                    {out && (
                      <span className={cn(m.status === 'failed' && 'font-medium text-danger-700')}>
                        · {tr(whatsappStatusLabels[m.status])}
                      </span>
                    )}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {elsewhere && (
        <p className="text-sm text-ink-muted">
          {tr('תשובה מהעמוד נשלחת ב־{0}, הערוץ שבו הלקוח כתב לאחרונה.', channelName(replyChannel))}
        </p>
      )}
      {(!replyHere || (!replyUntil && !mail)) && action}
      {replyHere &&
        (replyUntil || mail ? (
          <form noValidate onSubmit={submit} className="flex flex-col gap-2">
            <Textarea
              id={WHATSAPP_REPLY_ID}
              label={
                mail
                  ? tr('תשובה במייל')
                  : fb
                    ? tr('תשובה בפייסבוק')
                    : ig
                      ? tr('תשובה באינסטגרם')
                      : tr('תשובה בוואטסאפ')
              }
              rows={2}
              hint={
                mail || !replyUntil
                  ? tr('התשובה נשלחת במייל, מאותה כתובת שאליה הלקוח כתב.')
                  : tr(
                      'אפשר לענות עד {0} (24 שעות מההודעה האחרונה של הלקוח).',
                      timeFmt.format(new Date(replyUntil)),
                    )
              }
              error={form.formState.errors.text?.message}
              {...form.register('text')}
            />
            {send.isError && <Alert tone="danger">{errorMessage(send.error)}</Alert>}
            <Button type="submit" size="sm" loading={send.isPending} className="self-end">
              {mail
                ? tr('שליחה במייל')
                : fb
                  ? tr('שליחה בפייסבוק')
                  : ig
                    ? tr('שליחה באינסטגרם')
                    : tr('שליחה בוואטסאפ')}
            </Button>
          </form>
        ) : (
          messages.length > 0 && (
            <Alert tone="info">
              {tr(
                ig
                  ? whatsappMessages.instagramWindowClosed
                  : fb
                    ? whatsappMessages.messengerWindowClosed
                    : whatsappMessages.windowClosed,
              )}
            </Alert>
          )
        ))}
    </Card>
  );
}
