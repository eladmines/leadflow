import { type Channel, type Lead, type WhatsAppMessage } from '@simplecatch/shared';
import { Mail, MessageCircle } from 'lucide-react';
import { useRef, type KeyboardEvent } from 'react';
import { buttonClasses } from '../../components/ui';
import { cn } from '../../lib/cn';
import { isRtl, tr } from '../../i18n';
import { useChannels } from '../settings/channelsApi';
import { useCurrentBusiness } from '../shell/CurrentBusiness';
import { WhatsAppThread } from '../whatsapp/WhatsAppThread';
import { formatDateTime, timeAgo } from './api';

/** The "תקשורת" tab's channels (D-221), in this order. No call log yet, so no phone. */
export const COMM_CHANNELS = ['whatsapp', 'email', 'messenger', 'instagram'] as const;
export type CommChannel = (typeof COMM_CHANNELS)[number];

/** `?channel=` values: the channel names, and "facebook" for Messenger. */
export function parseChannel(value: string | null): CommChannel | null {
  if (value === 'facebook') return 'messenger';
  return value && (COMM_CHANNELS as readonly string[]).includes(value)
    ? (value as CommChannel)
    : null;
}

const channelOf = (m: WhatsAppMessage): Channel => m.channel ?? 'whatsapp';

/** A lead's source, as a conversation channel (facebook → Messenger). */
function sourceChannel(source: Lead['source']): CommChannel | null {
  if (source === 'facebook') return 'messenger';
  return source === 'whatsapp' || source === 'email' || source === 'instagram' ? source : null;
}

/**
 * WhatsApp and email always; Facebook and Instagram when the business has them connected or the
 * lead has messages there (D-221).
 */
export function useCommChannels(messages: WhatsAppMessage[]): CommChannel[] {
  const business = useCurrentBusiness();
  const channels = useChannels(business.id);
  const used = new Set(messages.map(channelOf));
  return COMM_CHANNELS.filter(
    (c) =>
      c === 'whatsapp' || c === 'email' || used.has(c) || Boolean(channels.data?.[c]?.connected),
  );
}

/** The latest message's channel, else the lead's source channel, else WhatsApp (D-221). */
export function defaultChannel(
  lead: Lead,
  messages: WhatsAppMessage[],
  shown: CommChannel[],
): CommChannel {
  const last = messages.at(-1);
  const candidates = [last ? channelOf(last) : null, sourceChannel(lead.source)];
  return (
    (candidates.find((c) => c && (shown as Channel[]).includes(c)) as CommChannel | undefined) ??
    'whatsapp'
  );
}

/** The customer's messages after the team's last reply. */
export function awaitingReply(messages: WhatsAppMessage[]) {
  let n = 0;
  for (let i = messages.length - 1; i >= 0 && messages[i]!.direction === 'IN'; i--) n += 1;
  return n;
}

const subTabLabels: Record<CommChannel, () => string> = {
  whatsapp: () => 'WhatsApp',
  email: () => tr('אימייל'),
  messenger: () => tr('פייסבוק'),
  instagram: () => 'Instagram',
};

const waLink = (phone: string) => `https://wa.me/${phone.replace(/\D/g, '')}`;

/**
 * The "תקשורת" tab (D-221): "ממתין לתשובה שלך" when the customer wrote last, then a sub-tab per
 * channel, each with that channel's conversation and, where the page can't reply, how to start.
 */
export function LeadCommunication({
  lead,
  messages,
  shown,
  channel,
  onSelect,
}: {
  lead: Lead;
  messages: WhatsAppMessage[];
  shown: CommChannel[];
  channel: CommChannel;
  onSelect: (channel: CommChannel) => void;
}) {
  const last = messages.at(-1);
  const waiting = last?.direction === 'IN' ? last : null;
  const refs = useRef<Partial<Record<CommChannel, HTMLButtonElement | null>>>({});

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, at: number) => {
    const forward = isRtl() ? 'ArrowLeft' : 'ArrowRight';
    const backward = isRtl() ? 'ArrowRight' : 'ArrowLeft';
    let to: number | null = null;
    if (e.key === forward) to = (at + 1) % shown.length;
    else if (e.key === backward) to = (at - 1 + shown.length) % shown.length;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = shown.length - 1;
    if (to === null) return;
    e.preventDefault();
    const next = shown[to]!;
    onSelect(next);
    refs.current[next]?.focus();
  };

  // Waiting messages per channel (the customer's messages after the team's last reply there).
  const waitingIn = (c: CommChannel) => awaitingReply(messages.filter((m) => channelOf(m) === c));

  return (
    <div className="flex flex-col gap-3">
      {waiting && (
        <p className="flex items-center gap-1.5 rounded-lg bg-warning-50 px-3 py-2 text-sm text-warning-600">
          <MessageCircle aria-hidden className="h-4 w-4 shrink-0" />
          <span>
            {tr('ממתין לתשובה שלך:')}{' '}
            <time dateTime={waiting.createdAt} title={formatDateTime(waiting.createdAt)}>
              {timeAgo(waiting.createdAt)}
            </time>
          </span>
        </p>
      )}
      <div role="tablist" aria-label={tr('ערוצי תקשורת')} className="flex flex-wrap gap-1.5">
        {shown.map((c, i) => {
          const n = waitingIn(c);
          const label = subTabLabels[c]();
          return (
            <button
              key={c}
              ref={(el) => {
                refs.current[c] = el;
              }}
              id={`lead-comm-tab-${c}`}
              type="button"
              role="tab"
              aria-selected={channel === c}
              aria-controls={`lead-comm-panel-${c}`}
              aria-label={n > 0 ? tr('{0}, {1} הודעות חדשות', label, n) : label}
              tabIndex={channel === c ? 0 : -1}
              onClick={() => onSelect(c)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ring-1 ring-inset focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400',
                channel === c
                  ? 'bg-brand-50 text-brand-700 ring-brand-600'
                  : 'text-ink-muted ring-surface-border hover:bg-surface-muted hover:text-ink',
              )}
            >
              {n > 0 && <span aria-hidden className="h-2 w-2 rounded-full bg-success-600" />}
              <span aria-hidden>{label}</span>
              {n > 0 && (
                <span aria-hidden className="text-xs font-normal">
                  {n}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div
        id={`lead-comm-panel-${channel}`}
        role="tabpanel"
        tabIndex={-1}
        aria-labelledby={`lead-comm-tab-${channel}`}
        className="focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 [&>*]:border-0 [&>*]:p-0 [&>*]:shadow-none"
      >
        <WhatsAppThread
          key={channel}
          leadId={lead.id}
          channel={channel}
          action={<StartAction lead={lead} channel={channel} />}
        />
      </div>
    </div>
  );
}

/** How to write to the customer outside the page: wa.me or mailto (nothing for Facebook/Instagram). */
function StartAction({ lead, channel }: { lead: Lead; channel: CommChannel }) {
  const { phone, email } = lead.contact;
  if (channel === 'whatsapp') {
    if (!phone) return <p className="text-sm text-ink-muted">{tr('אין מספר טלפון לליד.')}</p>;
    return (
      <a
        href={waLink(phone)}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(buttonClasses('secondary', 'sm'), 'self-start')}
      >
        <MessageCircle aria-hidden className="h-4 w-4" />
        {tr('פתיחה ב־WhatsApp')}
      </a>
    );
  }
  if (channel === 'email') {
    if (!email) return <p className="text-sm text-ink-muted">{tr('אין כתובת מייל לליד.')}</p>;
    return (
      <a href={`mailto:${email}`} className={cn(buttonClasses('secondary', 'sm'), 'self-start')}>
        <Mail aria-hidden className="h-4 w-4" />
        {tr('+ מייל')}
        <bdi dir="ltr">{email}</bdi>
      </a>
    );
  }
  return null;
}
