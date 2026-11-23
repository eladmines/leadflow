import { Code2 } from 'lucide-react';
import { useState } from 'react';
import { Alert, Card, CollapseButton, ScrollTabs, Spinner } from '../../components/ui';
import { useCollapsed } from '../../lib/useCollapsed';
import { cn } from '../../lib/cn';
import { Paste, Step, Steps } from '../reports/AdsGuideDialog';
import { errorMessage } from '../auth/serverErrors';
import { useEmbedInfo } from './embedApi';
import { tr } from '../../i18n';

// The "more options" box below is hidden for now (commented out); its examples:
// const CTA_EXAMPLE = '<button data-sc-click="book-appointment">Book</button>';
// const TRACK_EXAMPLE = 'data-track="#book-btn=book-appointment"';
//
// const SECTION_EXAMPLE = '<section data-sc-section="pricing">…</section>';
// const SECTIONS_TRACK_EXAMPLE = 'data-track-sections="#pricing=pricing"';
//
// const FORM_EXAMPLE = `<form data-simplecatch data-success="Thank you!">
//   <input name="name" required>
//   <input name="phone" required>
//   <input name="email">
//   <textarea name="message"></textarea>
//   <label><input type="checkbox" name="consent" required> I agree to be contacted</label>
//   <button type="submit">Send</button>
// </form>`;

/** The line for a Shopify theme: it also connects the "Contact us" form and lets Shopify keep its own copy. */
const shopifySnippet = (info: { scriptUrl: string; key: string }) =>
  `<script async src="${info.scriptUrl}" data-key="${info.key}" data-forms="form[action*='/contact']" data-consent-implied data-passthrough></script>`;

const TABS = ['wix', 'wordpress', 'shopify', 'other'] as const;
type Tab = (typeof TABS)[number];

/** Where to paste it, in plain words, for the most common site builders (their menus change now and then). */
function PlatformSteps({ tab, message, shopify }: { tab: Tab; message: string; shopify: string }) {
  if (tab === 'wix') {
    return (
      <Steps>
        <Step>{tr('בעורך של Wix: הגדרות (Settings) ← קוד מותאם (Custom code).')}</Step>
        <Step>{tr('לחצו "הוספת קוד" (Add code) והדביקו את השורה שהעתקתם.')}</Step>
        <Step>
          {tr(
            'בחרו "כל הדפים" ו"סוף ה-Body" (Body – end), לחצו "החלה", ואז פרסמו את האתר. בדרך כלל צריך חבילה בתשלום של Wix.',
          )}
        </Step>
      </Steps>
    );
  }
  if (tab === 'wordpress') {
    return (
      <Steps>
        <Step>{tr('התקינו את התוסף החינמי WPCode (תוספים ← הוספת תוסף, וחפשו "WPCode").')}</Step>
        <Step>{tr('Code Snippets ← Header & Footer, והדביקו את השורה בתיבה "Footer". שמרו.')}</Step>
      </Steps>
    );
  }
  if (tab === 'shopify') {
    return (
      <Steps>
        <Step>
          {tr(
            'בניהול Shopify: Online Store ← Themes ← ⋯ ← Edit code, ופתחו את layout/theme.liquid.',
          )}
        </Step>
        <Step>
          {tr(
            'הדביקו ממש לפני התגית </body> ושמרו. כאן הדביקו את השורה הזו במקום השורה שהעתקתם למעלה, כי היא מחברת גם את טופס "צור קשר" של Shopify:',
          )}
          <Paste text={shopify} />
          <span className="text-xs text-ink-muted">
            {tr(
              'כדי שפנייה תגיע אלינו כליד, הטלפון בטופס צריך להיות שדה חובה (בערכות רבות הוא רשות). הפנייה ממשיכה להגיע גם ל-Shopify.',
            )}
          </span>
        </Step>
      </Steps>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-ink">
        {tr('לא בטוחים איך? שלחו את ההודעה הזו למי שבנה או מתחזק את האתר:')}
      </p>
      <Paste text={message} />
    </div>
  );
}

/** Small marks for the site builders, drawn here as simple shapes (a letter on the builder's colour). */
function BuilderIcon({ tab }: { tab: Tab }) {
  const box = 'h-5 w-5 shrink-0';
  if (tab === 'wix') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden className={box}>
        <rect width="24" height="24" rx="6" fill="#111827" />
        <text
          x="12"
          y="15.5"
          textAnchor="middle"
          fontSize="9"
          fontWeight="800"
          fill="#fff"
          fontFamily="system-ui, Arial, sans-serif"
        >
          Wix
        </text>
      </svg>
    );
  }
  if (tab === 'wordpress') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden className={box}>
        <circle cx="12" cy="12" r="11" fill="#21759B" />
        <text
          x="12"
          y="17"
          textAnchor="middle"
          fontSize="14"
          fontWeight="700"
          fill="#fff"
          fontFamily="Georgia, 'Times New Roman', serif"
        >
          W
        </text>
      </svg>
    );
  }
  if (tab === 'shopify') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden className={box}>
        <path d="M5 8h14l-1 13H6L5 8z" fill="#95BF47" />
        <path
          d="M8.5 8V6.5a3.5 3.5 0 0 1 7 0V8"
          fill="none"
          stroke="#5E8E3E"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
        <text
          x="12"
          y="17.5"
          textAnchor="middle"
          fontSize="9"
          fontWeight="800"
          fill="#fff"
          fontFamily="system-ui, Arial, sans-serif"
        >
          S
        </text>
      </svg>
    );
  }
  return <Code2 aria-hidden className={cn(box, 'text-ink-muted')} />;
}

/**
 * F30-F32: connecting a website built elsewhere: one line to paste (it counts visits and behavior),
 * and, if wanted, forms that become leads, named buttons and sections, and ad tags.
 */
export function EmbedGuide({ businessId }: { businessId: string }) {
  const info = useEmbedInfo(businessId, true);
  const [tab, setTab] = useState<Tab>('wix');
  const [hidden, toggle] = useCollapsed('site-embed-guide');
  const labels: Record<Tab, string> = {
    wix: 'Wix',
    wordpress: 'WordPress',
    shopify: 'Shopify',
    other: tr('אחר'),
  };
  const message = info.data
    ? `${tr('שלום, אפשר להוסיף את השורה הבאה לכל דפי האתר, ממש לפני התגית </body>? זה מונה כניסות לאתר.')}\n\n${info.data.snippet}`
    : '';
  return (
    <Card className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold text-ink">{tr('קבלת פניות והמקור שלהן מהאתר')}</h2>
          <p className="text-sm text-ink-muted">
            {tr(
              'אפשר לחבר את האתר הקיים: כל פנייה מהטופס תיכנס לכאן כליד, ותראו כמה גולשים נכנסו, מאיפה הגיעו ומה הם עושים באתר.',
            )}
          </p>
        </div>
        <CollapseButton
          collapsed={hidden}
          onToggle={toggle}
          controls="site-embed-guide"
          label={tr('קבלת פניות והמקור שלהן מהאתר')}
        />
      </div>
      {!hidden && (
        <div id="site-embed-guide" className="flex flex-col gap-5">
          <p className="text-sm text-ink">
            {tr(
              'איך זה עובד: מדביקים באתר שורה אחת, פעם אחת. אחר כך, בדף "דוחות", רואים כמה גולשים נכנסו, מאיפה הגיעו (גוגל, פייסבוק, קישור אחר) ואילו דפים ראו. לא נאספים פרטים אישיים.',
            )}
          </p>
          {info.isPending && <Spinner size="sm" label={tr('טוענים…')} />}
          {info.isError && <Alert tone="danger">{errorMessage(info.error)}</Alert>}
          {info.data && (
            <>
              <Steps>
                <Step>
                  {tr('העתיקו את השורה הזו:')}
                  <Paste text={info.data.snippet} />
                </Step>
                <Step>
                  {tr(
                    'הדביקו אותה באתר, בכל הדפים, בסוף הדף (לפני התגית </body>). איך עושים את זה בבונה שלכם?',
                  )}
                  <ScrollTabs
                    label={tr('בונה אתרים')}
                    activeKey={tab}
                    className="rounded-xl bg-surface-sunken p-1"
                  >
                    {TABS.map((t) => (
                      <button
                        key={t}
                        type="button"
                        role="tab"
                        aria-selected={tab === t}
                        onClick={() => setTab(t)}
                        className={cn(
                          'inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-sm',
                          tab === t ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted',
                        )}
                      >
                        <BuilderIcon tab={t} />
                        {labels[t]}
                      </button>
                    ))}
                  </ScrollTabs>
                  <PlatformSteps tab={tab} message={message} shopify={shopifySnippet(info.data)} />
                </Step>
                <Step>
                  {tr(
                    'בדקו שזה עובד: פתחו את האתר שלכם (עדיף בחלון גלישה פרטי), ואחרי דקה חזרו ל"דוחות". הכרטיס "כניסות לאתר" יעלה. אם הוא נשאר 0, ודאו שהדבקתם בכל הדפים ושחוסם פרסומות לא פעיל.',
                  )}
                </Step>
              </Steps>

              {/*
              <div className="flex flex-col gap-3 rounded-2xl bg-surface-muted p-4">
                <h3 className="text-sm font-semibold text-ink">
                  {tr('אפשרויות נוספות (לא חובה)')}
                </h3>
                <Steps>
                  <Step>
                    {tr(
                      'רוצים שפניות מהטופס באתר יגיעו אליכם כלידים? בתגית form של טופס "צור קשר" הוסיפו data-simplecatch, ותנו לשדות את השמות האלה: name (שם), phone (טלפון), email (מייל), message (הודעה) ו-consent (תיבת אישור):',
                    )}
                    <Paste text={FORM_EXAMPLE} />
                    <span className="text-xs text-ink-muted">
                      {tr('הטלפון חובה, ובלי תיבת אישור הפנייה לא תתקבל.')}
                    </span>
                  </Step>
                  <Step>
                    {tr(
                      'רוצים לדעת כמה לוחצים על כפתור מסוים (למשל "קבע תור")? תנו לכפתור שם, ותראו אותו בדוחות:',
                    )}
                    <Paste text={CTA_EXAMPLE} />
                    {tr(
                      'אי אפשר להוסיף תכונה לכפתור? כתבו על שורת הסקריפט את המזהה (id) של הכפתור ואת השם, כך:',
                    )}
                    <Paste text={TRACK_EXAMPLE} />
                  </Step>
                  <Step>
                    {tr(
                      'רוצים לדעת אילו חלקים בדף הגולשים באמת רואים (מחירון, שאלות נפוצות...)? תנו שם לחלק, ונספור כשהוא היה על המסך לפחות חצי שנייה:',
                    )}
                    <Paste text={SECTION_EXAMPLE} />
                    {tr('או, בלי לגעת באתר עצמו, כתבו על שורת הסקריפט:')}
                    <Paste text={SECTIONS_TRACK_EXAMPLE} />
                  </Step>
                  <Step>
                    {tr(
                      'רוצים לדעת איזו מודעה הביאה כל פנייה? הוסיפו סימון בקישור של כל מודעה (ראו "חיבור המודעות" בדוחות). הוא נשמר 30 יום בדפדפן של הגולש, ונשלח עם הפנייה.',
                    )}
                  </Step>
                </Steps>
              </div>
              */}
            </>
          )}
          <p className="text-xs text-ink-muted">
            {tr(
              'הסקריפט לא אוסף פרטים אישיים: רק את שם הקמפיין, הקישור המפנה והדף. ערך מזהה הקליק (gclid) לא נשמר.',
            )}
          </p>
        </div>
      )}
    </Card>
  );
}
