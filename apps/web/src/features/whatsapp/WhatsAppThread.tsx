import {
  sendWhatsAppRequestSchema,
  whatsappMessages,
  whatsappStatusLabels,
  type SendWhatsAppRequest,
} from '@leadflow/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { Bot, MessageCircle } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { Alert, Button, Card, Spinner, Textarea } from '../../components/ui';
import { cn } from '../../lib/cn';
import { errorMessage } from '../auth/serverErrors';
import { formatDateTime, timeAgo } from '../leads/api';
import { useCurrentBusiness } from '../shell/CurrentBusiness';
import { usePauseBot, useSendWhatsApp, useWhatsAppThread } from './api';
import { tr, intlLocale } from '../../i18n';

const timeFmt = new Intl.DateTimeFormat(intlLocale(), { hour: '2-digit', minute: '2-digit' });

/**
 * WhatsApp conversation with the lead's contact (F12 POC). Hidden for businesses without a
 * connected number, unless older messages exist.
 */
export function WhatsAppThread({ leadId }: { leadId: string }) {
  const business = useCurrentBusiness();
  const thread = useWhatsAppThread(business.id, leadId);
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
        <Spinner size="sm" label={tr('טוענים את שיחת הוואטסאפ…')} />
      </Card>
    );
  }
  if (thread.isError) {
    return (
      <Card className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-ink">WhatsApp</h2>
        <Alert tone="danger">{errorMessage(thread.error)}</Alert>
      </Card>
    );
  }
  const { connected, messages, replyUntil, botPaused } = thread.data;
  // Its own tab on the lead page (D-140), so say why it's empty rather than show nothing.
  if (!connected && messages.length === 0) {
    return (
      <Card className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold text-ink">WhatsApp</h2>
        <p className="text-sm text-ink-muted">
          {tr('אין שיחת וואטסאפ עם הליד. אחרי חיבור מספר WhatsApp לעסק, ההודעות יופיעו כאן.')}
        </p>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-ink">
          <MessageCircle aria-hidden className="h-5 w-5 text-success-600" />
          WhatsApp
        </h2>
        {connected && (
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
          {tr('עדיין אין הודעות. כשהלקוח יכתוב לעסק בוואטסאפ, השיחה תופיע כאן.')}
        </p>
      ) : (
        <ol
          aria-label={tr('שיחת וואטסאפ')}
          className="flex max-h-[28rem] flex-col gap-2 overflow-y-auto"
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
                  <p className="whitespace-pre-line break-words">{m.body}</p>
                  <p className="flex items-center gap-1.5 text-xs text-ink-muted">
                    <time dateTime={m.createdAt} title={formatDateTime(m.createdAt)}>
                      {timeAgo(m.createdAt)}
                    </time>
                    {out && !m.sender && <span>· {tr('תשובה אוטומטית')}</span>}
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
      {connected &&
        (replyUntil ? (
          <form noValidate onSubmit={submit} className="flex flex-col gap-2">
            <Textarea
              label={tr('תשובה בוואטסאפ')}
              rows={2}
              hint={tr(
                'אפשר לענות עד {0} (24 שעות מההודעה האחרונה של הלקוח).',
                timeFmt.format(new Date(replyUntil)),
              )}
              error={form.formState.errors.text?.message}
              {...form.register('text')}
            />
            {send.isError && <Alert tone="danger">{errorMessage(send.error)}</Alert>}
            <Button type="submit" size="sm" loading={send.isPending} className="self-end">
              {tr('שליחה בוואטסאפ')}
            </Button>
          </form>
        ) : (
          messages.length > 0 && <Alert tone="info">{whatsappMessages.windowClosed}</Alert>
        ))}
    </Card>
  );
}
