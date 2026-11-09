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
      className="flex flex-col gap-2 rounded-2xl bg-[#efeae2] p-3 sm:p-4"
    >
      <Bubble from="customer">{tr('היי, אפשר לשאול משהו?')}</Bubble>
      <Bubble from="business">
        <span className="whitespace-pre-line">{message || '—'}</span>
        <span className="mt-2 flex items-center justify-center gap-1.5 border-t border-black/10 pt-2 text-sm font-medium text-[#008069]">
          <List aria-hidden className="h-4 w-4" />
          {tr('מתי נוח לדבר?')}
        </span>
      </Bubble>
      <ul
        aria-label={tr('האפשרויות ברשימה')}
        className="ms-4 flex max-w-xs flex-col divide-y divide-black/5 rounded-xl bg-white/80 text-sm text-ink shadow-sm"
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
              <bdi dir="ltr" className="block break-all text-[#027eb5] underline">
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
            <div className="flex gap-1.5">
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

function Bubble({ from, children }: { from: 'customer' | 'business'; children: ReactNode }) {
  return (
    <div
      dir="auto"
      className={cn(
        'flex max-w-xs flex-col rounded-2xl px-3 py-2 text-sm text-ink shadow-sm',
        // The business's own messages on one side, the customer's on the other, as in WhatsApp.
        from === 'customer'
          ? 'self-end rounded-ee-sm bg-[#d9fdd3]'
          : 'self-start rounded-es-sm bg-white',
      )}
    >
      {children}
    </div>
  );
}
