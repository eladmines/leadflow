import { fillBotText, type WhatsAppBotResponse } from '@leadflow/shared';
import { List, Video } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { useAssets } from '../media/api';
import { useCurrentBusiness } from '../shell/CurrentBusiness';
import { tr } from '../../i18n';

type Saved = WhatsAppBotResponse['settings'];

/** Example hours, as the customer sees them (the real list is the next free hours, D-169). */
const EXAMPLE_HOURS = ['היום ב־18:00', 'היום ב־19:00', 'מחר ב־09:00'];
const PICKED = 'מחר ב־09:00';

/**
 * What the customer sees with this status (D-172): their message, the status message with "When
 * can we talk?", their pick, the confirmation, then "A peek at the business" when it's on.
 */
export function ConversationPreview({
  businessId,
  saved,
  message,
}: {
  businessId: string;
  saved: Saved;
  /** The status message as written now (placeholders filled in). */
  message: string;
}) {
  const business = useCurrentBusiness();
  const assets = useAssets(businessId);
  const peek = saved.showcase;
  const booking = saved.mode === 'booking';
  const peekText = fillBotText(peek.text ?? peek.defaultText, {
    business: business.name,
    service: 'תור',
    when: '',
  });
  const photos = peek.assetIds
    .map((id) => assets.data?.assets.find((a) => a.id === id)?.url)
    .filter((url): url is string => Boolean(url));

  return (
    <div
      role="group"
      aria-label={tr('כך תיראה השיחה')}
      className="flex flex-col gap-2 rounded-2xl border border-surface-border bg-surface p-3 sm:p-4"
    >
      <Bubble from="customer">{tr('היי, אפשר לשאול משהו?')}</Bubble>
      <Bubble from="business">
        <span className="whitespace-pre-line">{message || '—'}</span>
        <span className="mt-2 flex items-center justify-center gap-1.5 border-t border-success-600/20 pt-2 text-sm font-medium text-brand-700">
          <List aria-hidden className="h-4 w-4" />
          {tr('מתי נוח לדבר?')}
        </span>
      </Bubble>
      <ul
        aria-label={tr('האפשרויות ברשימה')}
        className="flex max-w-[85%] flex-col divide-y divide-surface-border self-end rounded-xl border border-surface-border bg-surface text-sm text-ink"
      >
        {[
          ...EXAMPLE_HOURS.map((h) => tr(h)),
          tr('זמן אחר'),
          ...(booking ? [tr('📅 לקביעת תור')] : []),
        ].map((row) => (
          <li key={row} className="px-3 py-1.5">
            {row}
          </li>
        ))}
      </ul>
      <Bubble from="customer">{tr(PICKED)}</Bubble>
      <Bubble from="business">{tr('מעולה! נחזור אליכם {0} 🙏', tr(PICKED))}</Bubble>
      {peek.enabled ? (
        <>
          <Bubble from="business">
            <span className="whitespace-pre-line">{peekText}</span>
            {peek.link && (
              <bdi dir="ltr" className="block break-all text-brand-700 underline">
                {peek.link}
              </bdi>
            )}
          </Bubble>
          {peek.video && (
            <Bubble from="business">
              <span className="flex items-center gap-1.5">
                <Video aria-hidden className="h-4 w-4" />
                {tr('סרטון')}
              </span>
            </Bubble>
          )}
          {photos.length > 0 && (
            <div className="flex gap-1.5 self-end">
              {photos.map((url) => (
                <img key={url} src={url} alt="" className="h-16 w-16 rounded-xl object-cover" />
              ))}
            </div>
          )}
        </>
      ) : (
        <p className="text-center text-xs text-ink-muted">
          {tr('"הצצה לעסק" כבויה, אז השיחה מסתיימת כאן.')}
        </p>
      )}
      <p className="text-center text-xs text-ink-muted">
        {tr('השעות הן דוגמה: הלקוח רואה את השעות הפנויות הקרובות.')}
      </p>
    </div>
  );
}

/**
 * Looks like the inbox (Conversations): the customer's messages on the start side, grey; the
 * business's replies on the other, green, marked as automatic.
 */
function Bubble({ from, children }: { from: 'customer' | 'business'; children: ReactNode }) {
  const business = from === 'business';
  return (
    <div
      dir="auto"
      className={cn(
        'flex max-w-[85%] flex-col gap-1 rounded-2xl px-3.5 py-2 text-sm text-ink',
        business
          ? 'self-end rounded-ee-sm bg-success-50 ring-1 ring-success-600/20'
          : 'self-start rounded-es-sm bg-surface-muted',
      )}
    >
      {children}
      {business && <span className="text-xs text-ink-muted">{tr('תשובה אוטומטית')}</span>}
    </div>
  );
}
