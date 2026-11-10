import { zodResolver } from '@hookform/resolvers/zod';
import {
  businessWebPaths,
  formatIsraeliPhone,
  sendWhatsAppRequestSchema,
  whatsappMessages,
  whatsappStatusLabels,
  type Channel,
  type ConversationFilter,
  type ConversationSummary,
  type SendWhatsAppRequest,
} from '@leadflow/shared';
import { ChevronLeft, ChevronRight, MessagesSquare } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useScrollToLatest } from '../../lib/useScrollToLatest';
import { useForm } from 'react-hook-form';
import { Link, useSearchParams } from 'react-router-dom';
import { Alert, Button, EmptyState, Spinner, Textarea } from '../../components/ui';
import { cn } from '../../lib/cn';
import { intlLocale, tr } from '../../i18n';
import { errorMessage } from '../auth/serverErrors';
import { formatDateTime, timeAgo } from '../leads/api';
import { useConversation, useConversations, useMarkRead, useReply } from './api';

/** WhatsApp green, Facebook blue: the channel's colour on its chip and dot. */
const CHANNEL_STYLE: Record<Channel, { label: string; chip: string; dot: string }> = {
  whatsapp: { label: 'WhatsApp', chip: 'bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500' },
  messenger: { label: 'פייסבוק', chip: 'bg-blue-50 text-blue-700', dot: 'bg-blue-600' },
  email: { label: 'מייל', chip: 'bg-sky-50 text-sky-700', dot: 'bg-sky-500' },
};

const showPhone = (e164: string) => (e164.startsWith('+972') ? formatIsraeliPhone(e164) : e164);
/** A name to show: the person's, else the phone or email address, else "Facebook user". */
const nameOf = (c: ConversationSummary) =>
  c.name || (c.phone ? showPhone(c.phone) : c.email || tr('משתמש/ת פייסבוק'));

/**
 * F24 unified inbox (D-158): every conversation — WhatsApp and Facebook — in one list, the open one
 * beside it with its reply box. On a phone the list and the conversation take turns. The open
 * conversation is kept in the address (`?c=`).
 */
export function InboxView({ businessId }: { businessId: string }) {
  const [params, setParams] = useSearchParams();
  const selected = params.get('c');
  const [filter, setFilter] = useState<ConversationFilter>('all');
  const [channel, setChannel] = useState<Channel | undefined>();
  const list = useConversations(businessId, filter, channel);
  const open = (id: string | null) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (id) next.set('c', id);
        else next.delete('c');
        return next;
      },
      { replace: !id },
    );

  const conversations = list.data?.pages.flatMap((p) => p.conversations) ?? [];
  const first = list.data?.pages[0];
  const filters: { key: ConversationFilter; label: string }[] = [
    { key: 'all', label: tr('הכול') },
    { key: 'unread', label: tr('לא נקראו') },
  ];

  return (
    // Fits the screen under the page's title and tabs (D-174): the list and the open chat scroll
    // inside it, the page doesn't, and the reply box stays in view — on phones too.
    <div className="grid h-[calc(100dvh-11rem)] min-h-[24rem] overflow-hidden rounded-2xl border border-surface-border bg-surface shadow-card md:h-[calc(100dvh-14rem)] md:grid-cols-[22rem_1fr]">
      <div
        className={cn(
          'flex min-h-0 flex-col border-surface-border md:border-e',
          selected && 'hidden md:flex',
        )}
      >
        <div className="flex flex-col gap-2 border-b border-surface-border p-3">
          <div role="group" aria-label={tr('סינון שיחות')} className="flex gap-1">
            {filters.map((f) => (
              <button
                key={f.key}
                type="button"
                aria-pressed={filter === f.key}
                onClick={() => setFilter(f.key)}
                className={cn(
                  'rounded-full px-3 py-1 text-sm transition-colors',
                  filter === f.key
                    ? 'bg-brand-600 font-medium text-white'
                    : 'text-ink-muted hover:bg-surface-muted',
                )}
              >
                {f.label}
                {f.key === 'unread' && first && first.unreadCount > 0 && ` (${first.unreadCount})`}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-xs text-ink-muted">
            {tr('ערוץ:')}
            <select
              value={channel ?? ''}
              onChange={(e) => setChannel((e.target.value || undefined) as Channel | undefined)}
              className="h-8 rounded-lg border border-surface-border bg-surface px-2 text-sm text-ink"
            >
              <option value="">{tr('כל הערוצים')}</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="messenger">{tr('פייסבוק')}</option>
              <option value="email">{tr('מייל')}</option>
            </select>
          </label>
        </div>

        <div className="scrollbar-visible min-h-0 flex-1 overflow-y-auto">
          {list.isPending ? (
            <div className="p-4">
              <Spinner size="sm" label={tr('טוענים שיחות…')} />
            </div>
          ) : list.isError ? (
            <div className="p-3">
              <Alert tone="danger">{errorMessage(list.error)}</Alert>
            </div>
          ) : conversations.length === 0 ? (
            <EmptyState
              bare
              icon={MessagesSquare}
              tone="bg-emerald-500"
              title={filter === 'all' ? tr('עדיין אין שיחות') : tr('אין שיחות כאן')}
              description={
                first?.connected === false
                  ? tr('השיחות יופיעו כאן אחרי חיבור WhatsApp או פייסבוק לעסק.')
                  : tr('הודעות מלקוחות בוואטסאפ ובפייסבוק יופיעו כאן.')
              }
            />
          ) : (
            <ul aria-label={tr('שיחות')} className="divide-y divide-surface-border">
              {conversations.map((c) => (
                <li key={c.id}>
                  <ConversationRow c={c} active={c.id === selected} onOpen={() => open(c.id)} />
                </li>
              ))}
            </ul>
          )}
          {list.hasNextPage && (
            <div className="p-3">
              <Button
                variant="secondary"
                size="sm"
                className="w-full"
                loading={list.isFetchingNextPage}
                onClick={() => list.fetchNextPage()}
              >
                {tr('עוד שיחות')}
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className={cn('min-h-0 flex-col', selected ? 'flex' : 'hidden md:flex')}>
        {selected ? (
          <ConversationPane
            key={selected}
            businessId={businessId}
            id={selected}
            onBack={() => open(null)}
          />
        ) : (
          <div className="m-auto p-6">
            <EmptyState
              bare
              icon={MessagesSquare}
              tone="bg-emerald-500"
              title={tr('בחרו שיחה')}
              description={tr('לחיצה על שיחה ברשימה פותחת אותה כאן, עם אפשרות לענות.')}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function ConversationRow({
  c,
  active,
  onOpen,
}: {
  c: ConversationSummary;
  active: boolean;
  onOpen: () => void;
}) {
  const style = CHANNEL_STYLE[c.channel];
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-current={active ? 'true' : undefined}
      className={cn(
        'flex w-full items-start gap-3 px-3 py-3 text-start transition-colors',
        active ? 'bg-brand-50' : 'hover:bg-surface-muted',
      )}
    >
      <span
        aria-hidden
        className={cn('mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full', style.dot)}
        title={tr(style.label)}
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-baseline justify-between gap-2">
          {/* The name follows the page's side; <bdi> keeps a Latin name readable inside it. */}
          <span className={cn('truncate text-sm text-ink', c.unread && 'font-semibold')}>
            <bdi>{nameOf(c)}</bdi>
          </span>
          <time
            dateTime={c.lastMessageAt}
            title={formatDateTime(c.lastMessageAt)}
            className="shrink-0 text-xs text-ink-muted"
          >
            {timeAgo(c.lastMessageAt)}
          </time>
        </span>
        <span className="flex items-center gap-2">
          <span className="truncate text-xs text-ink-muted" dir="auto">
            {c.lastMessage?.direction === 'OUT' && `${tr('אתם:')} `}
            {c.lastMessage?.body ?? ''}
          </span>
          {c.unread && (
            <span className="ms-auto h-2 w-2 shrink-0 rounded-full bg-brand-600">
              <span className="sr-only">{tr('לא נקראה')}</span>
            </span>
          )}
        </span>
        <span className="flex gap-1.5 text-[11px]">
          <span className={cn('rounded-full px-1.5 py-px font-medium', style.chip)}>
            {tr(style.label)}
          </span>
        </span>
      </span>
    </button>
  );
}

function ConversationPane({
  businessId,
  id,
  onBack,
}: {
  businessId: string;
  id: string;
  onBack: () => void;
}) {
  const convo = useConversation(businessId, id);
  const listRef = useScrollToLatest<HTMLOListElement>(convo.data?.messages.at(-1)?.id);
  const markRead = useMarkRead(businessId);
  const reply = useReply(businessId, id);
  const form = useForm<SendWhatsAppRequest>({
    resolver: zodResolver(sendWhatsAppRequestSchema),
    defaultValues: { text: '' },
  });
  const unread = convo.data?.conversation.unread;
  // Opening it marks it read for the whole team.
  useEffect(() => {
    if (unread) markRead.mutate(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, unread]);

  if (convo.isPending) {
    return (
      <div className="p-4">
        <Spinner size="sm" label={tr('טוענים את השיחה…')} />
      </div>
    );
  }
  if (convo.isError) {
    return (
      <div className="flex flex-col gap-3 p-4">
        <BackButton onBack={onBack} />
        <Alert tone="danger">{errorMessage(convo.error)}</Alert>
      </div>
    );
  }
  const { conversation: c, messages, replyUntil } = convo.data;
  const style = CHANNEL_STYLE[c.channel];
  const fb = c.channel === 'messenger';
  const mail = c.channel === 'email';
  const time = new Intl.DateTimeFormat(intlLocale(), {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  const submit = form.handleSubmit((v) => reply.mutate(v, { onSuccess: () => form.reset() }));

  return (
    <section aria-labelledby={`convo-${id}`} className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b border-surface-border p-3">
        <BackButton onBack={onBack} />
        <div className="min-w-0 flex-1">
          <h2 id={`convo-${id}`} className="truncate font-semibold text-ink">
            <bdi>{nameOf(c)}</bdi>
          </h2>
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
            <span className={cn('rounded-full px-1.5 py-px font-medium', style.chip)}>
              {tr(style.label)}
            </span>
            {c.phone && <bdi dir="ltr">{showPhone(c.phone)}</bdi>}
            {c.email && <bdi dir="ltr">{c.email}</bdi>}
          </p>
        </div>
        {c.leadId && (
          <Link
            to={`${businessWebPaths.section(businessId, 'leads')}/${c.leadId}`}
            className="inline-flex items-center gap-0.5 text-sm font-medium text-brand-700 hover:underline"
          >
            {tr('פתיחת הליד')}
            <ChevronLeft aria-hidden className="h-4 w-4 ltr:rotate-180" />
          </Link>
        )}
      </header>

      <ol
        ref={listRef}
        aria-label={tr('הודעות בשיחה')}
        className="scrollbar-visible flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3"
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
                {m.subject && (
                  <p className="text-xs font-semibold" dir="auto">
                    {m.subject}
                  </p>
                )}
                <p className="whitespace-pre-line break-words" dir="auto">
                  {m.body}
                </p>
                <p className="flex items-center gap-1.5 text-xs text-ink-muted">
                  <time dateTime={m.createdAt} title={formatDateTime(m.createdAt)}>
                    {timeAgo(m.createdAt)}
                  </time>
                  {out && !m.sender && <span>· {tr('תשובה אוטומטית')}</span>}
                  {out && m.sender && <span>· {m.sender.name}</span>}
                  {out && c.channel === 'whatsapp' && (
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

      <div className="border-t border-surface-border p-3">
        {replyUntil || mail ? (
          <form noValidate onSubmit={submit} className="flex flex-col gap-2">
            <Textarea
              label={mail ? tr('תשובה במייל') : fb ? tr('תשובה בפייסבוק') : tr('תשובה בוואטסאפ')}
              rows={2}
              dir="auto"
              hint={
                mail || !replyUntil
                  ? tr('התשובה נשלחת במייל, מכתובת ההעברה של העסק.')
                  : tr(
                      'אפשר לענות עד {0} (24 שעות מההודעה האחרונה של הלקוח).',
                      time.format(new Date(replyUntil)),
                    )
              }
              error={form.formState.errors.text?.message}
              {...form.register('text')}
            />
            {reply.isError && <Alert tone="danger">{errorMessage(reply.error)}</Alert>}
            <Button type="submit" size="sm" loading={reply.isPending} className="self-end">
              {mail ? tr('שליחה במייל') : fb ? tr('שליחה בפייסבוק') : tr('שליחה בוואטסאפ')}
            </Button>
          </form>
        ) : (
          <Alert tone="info">
            {tr(fb ? whatsappMessages.messengerWindowClosed : whatsappMessages.windowClosed)}
          </Alert>
        )}
      </div>
    </section>
  );
}

/** Phones: back to the list. */
function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <button
      type="button"
      onClick={onBack}
      className="inline-flex items-center gap-0.5 rounded-lg px-1.5 py-1 text-sm text-ink-muted hover:bg-surface-muted md:hidden"
    >
      <ChevronRight aria-hidden className="h-4 w-4 ltr:rotate-180" />
      {tr('חזרה לשיחות')}
    </button>
  );
}
