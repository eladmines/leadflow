import { businessWebPaths } from '@leadflow/shared';
import { Check, Copy, Globe, MessageCircle } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Alert, DialogShell } from '../../components/ui';
import { cn } from '../../lib/cn';
import { AttributionIcon } from '../leads/SourceIcon';
import { useSite } from '../site/api';
import { tr } from '../../i18n';

const TABS = ['google', 'meta', 'whatsapp', 'other'] as const;
type Tab = (typeof TABS)[number];

/**
 * F26: connecting ads, one ad system per tab — numbered steps, the exact text to paste (with Copy),
 * and the business's own site address filled in.
 */
export function AdsGuideDialog({
  businessId,
  open,
  onOpenChange,
}: {
  businessId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [tab, setTab] = useState<Tab>('google');
  const site = useSite(businessId);
  const siteUrl = site.data?.published ? site.data.publicUrl : null;
  const address = siteUrl ?? tr('כתובת-האתר-שלכם');

  const labels: Record<Tab, { name: string; icon: ReactNode }> = {
    google: { name: 'Google Ads', icon: <AttributionIcon source="google" className="h-4 w-4" /> },
    meta: {
      name: tr('פייסבוק ואינסטגרם'),
      icon: <AttributionIcon source="meta" className="h-4 w-4" />,
    },
    whatsapp: {
      name: 'WhatsApp',
      icon: <MessageCircle aria-hidden className="h-4 w-4 text-[#25D366]" />,
    },
    other: {
      name: tr('קישורים אחרים'),
      icon: <Globe aria-hidden className="h-4 w-4 text-sky-600" />,
    },
  };

  return (
    <DialogShell open={open} onOpenChange={onOpenChange} title={tr('חיבור המודעות שלכם')} wide>
      <p className="text-sm text-ink-muted">
        {tr(
          'כך כל ליד יגיע עם המקור והקמפיין שהביאו אותו. אין צורך בסיסמה או בחיבור חשבון: מוסיפים סימון קטן לקישור של המודעה, ו-LeadFlow קורא אותו.',
        )}
      </p>
      {!site.isPending && !siteUrl && (
        <Alert tone="warning">
          {tr('המעקב עובד באתר שנבנה ב-LeadFlow ופורסם.')}{' '}
          <Link to={businessWebPaths.section(businessId, 'site')} className="font-medium underline">
            {tr('לאתר שלי')}
          </Link>
        </Alert>
      )}
      <div
        role="tablist"
        aria-label={tr('מערכת מודעות')}
        className="flex gap-1 overflow-x-auto rounded-xl bg-surface-sunken p-1"
      >
        {TABS.map((t) => (
          <button
            key={t}
            id={`ads-tab-${t}`}
            type="button"
            role="tab"
            aria-selected={tab === t}
            aria-controls={`ads-panel-${t}`}
            onClick={() => setTab(t)}
            className={cn(
              'inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm',
              tab === t ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted',
            )}
          >
            {labels[t].icon}
            {labels[t].name}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`ads-panel-${tab}`} aria-labelledby={`ads-tab-${tab}`}>
        {tab === 'google' && (
          <Steps>
            <Step>{tr('היכנסו ל-Google Ads ופתחו את הקמפיין.')}</Step>
            <Step>
              {tr(
                'לחצו על "הגדרות", ואז על "אפשרויות כתובת URL של הקמפיין" (Campaign URL options).',
              )}
            </Step>
            <Step>
              {tr(
                'בשדה "סיומת כתובת URL סופית" (Final URL suffix) הדביקו את השורה הזו, והחליפו את summer בשם הקמפיין:',
              )}
              <Paste text="utm_source=google&utm_medium=cpc&utm_campaign=summer&utm_term={keyword}" />
            </Step>
            <Step>{tr('שמרו. חזרו על זה בכל קמפיין, עם שם אחר לכל אחד.')}</Step>
            <Step>
              {tr(
                'מומלץ: בהגדרות החשבון הפעילו "תיוג אוטומטי" (Auto-tagging). כך גם קליק בלי שם קמפיין יסומן כ-Google Ads.',
              )}
            </Step>
          </Steps>
        )}
        {tab === 'meta' && (
          <Steps>
            <Step>{tr('היכנסו למנהל המודעות של Meta (Ads Manager) ופתחו את המודעה.')}</Step>
            <Step>
              {tr('גללו למטה עד "מעקב" (Tracking) ← "פרמטרים של כתובת URL" (URL parameters).')}
            </Step>
            <Step>
              {tr('הדביקו את השורה הזו כמו שהיא. פייסבוק ממלא את שם הקמפיין לבד:')}
              <Paste text="utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.name}}" />
            </Step>
            <Step>{tr('פרסמו את המודעה. זה עובד גם למודעות באינסטגרם.')}</Step>
          </Steps>
        )}
        {tab === 'whatsapp' && (
          <Steps>
            <Step>
              {tr(
                'מודעות "לחיצה לוואטסאפ" בפייסבוק ובאינסטגרם: לא צריך לעשות כלום. כשלקוח לוחץ על המודעה וכותב, הליד יגיע עם המודעה וכותרתה.',
              )}
            </Step>
            <Step>{tr('צריך רק שוואטסאפ יהיה מחובר בהגדרות ← ערוצים.')}</Step>
            <Step>
              {tr(
                'מודעות גוגל שפותחות וואטסאפ: גוגל לא מוסר מאיזו מודעה הגיעו. טיפ: כתבו בכל קמפיין הודעה פתוחה אחרת, למשל "היי, ראיתי את מבצע הקיץ".',
              )}
            </Step>
          </Steps>
        )}
        {tab === 'other' && (
          <Steps>
            <Step>
              {tr(
                'לכל קישור לאתר (ניוזלטר, ביו באינסטגרם, ברקוד על פלייר) הוסיפו בסוף את המקור והקמפיין:',
              )}
              <Paste text={`${address}?utm_source=newsletter&utm_campaign=november`} />
            </Step>
            <Step>{tr('החליפו את newsletter ו-november בשמות שלכם. כך הם יופיעו בדוחות.')}</Step>
          </Steps>
        )}
      </div>
      <div className="rounded-2xl bg-surface-muted p-4 text-sm text-ink">
        <p className="font-medium">{tr('איך בודקים שזה עובד?')}</p>
        <p className="mt-1 text-ink-muted">
          {tr(
            'לחצו על המודעה (או פתחו את הקישור עם הסימון), השאירו פרטים בטופס באתר, ובדקו בליד את "מאיפה הגיע". הליד יופיע גם כאן, בדוחות.',
          )}
        </p>
      </div>
      <p className="text-xs text-ink-muted">
        {tr('האתר שומר את המקור בעוגייה קטנה ל-30 יום, בלי פרטים אישיים, עד שהמבקר משאיר פרטים.')}
      </p>
    </DialogShell>
  );
}

function Steps({ children }: { children: ReactNode }) {
  return <ol className="flex list-none flex-col gap-3 [counter-reset:step]">{children}</ol>;
}

function Step({ children }: { children: ReactNode }) {
  return (
    <li className="flex gap-3 text-sm text-ink [counter-increment:step]">
      <span
        aria-hidden
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-white before:content-[counter(step)]"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-2 pt-0.5">{children}</div>
    </li>
  );
}

/** Text to paste into the ad system, with a Copy button. */
function Paste({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // No clipboard (old browser / no permission): the text stays selectable.
    }
  };
  return (
    <div className="flex items-stretch gap-2">
      <code
        dir="ltr"
        className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-lg bg-surface-sunken px-3 py-2 text-xs text-ink"
      >
        {text}
      </code>
      <button
        type="button"
        onClick={copy}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-surface px-3 text-sm font-medium text-brand-700 ring-1 ring-surface-border hover:bg-surface-muted"
      >
        {copied ? (
          <Check aria-hidden className="h-4 w-4" />
        ) : (
          <Copy aria-hidden className="h-4 w-4" />
        )}
        {copied ? tr('הועתק') : tr('העתקה')}
      </button>
    </div>
  );
}
