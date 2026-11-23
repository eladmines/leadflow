import { Alert, Card, Spinner } from '../../components/ui';
import { Paste, Step, Steps } from '../reports/AdsGuideDialog';
import { errorMessage } from '../auth/serverErrors';
import { useEmbedInfo } from './embedApi';
import { tr } from '../../i18n';

// For now only the visit count is offered (the script tag). The rest of the guide is kept below,
// commented out, to bring back when forms, buttons, sections and Shopify are offered again:
//
// const CTA_EXAMPLE = '<button data-sc-click="book-appointment">Book</button>';
// const TRACK_EXAMPLE = 'data-track="#book-btn=book-appointment; .buy-now=buy"';
//
// const SECTION_EXAMPLE = '<section data-sc-section="pricing">…</section>';
// const SECTIONS_TRACK_EXAMPLE = 'data-track-sections="#pricing=pricing; .faq-block=faq"';
//
// const FORM_EXAMPLE = `<form data-simplecatch data-success="Thank you!">
//   <input name="name" required>
//   <input name="phone" required>
//   <input name="email">
//   <textarea name="message"></textarea>
//   <label><input type="checkbox" name="consent" required> I agree to be contacted</label>
//   <button type="submit">Send</button>
// </form>`;
//
// /** The script tag for a Shopify theme: binds the contact form by its address and keeps Shopify's own copy. */
// const shopifySnippet = (info: { scriptUrl: string; key: string }) =>
//   `<script async src="${info.scriptUrl}" data-key="${info.key}" data-forms="form[action*='/contact']" data-consent-implied data-passthrough></script>`;

/**
 * F30/F31: counting visits to a website built elsewhere. The owner pastes one script tag. (Leads
 * from forms, named buttons and sections, and the Shopify steps are commented out for now.)
 */
export function EmbedGuide({ businessId }: { businessId: string }) {
  const info = useEmbedInfo(businessId, true);
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-ink">{tr('קבלת פניות והמקור שלהן מהאתר')}</h2>
        <p className="text-sm text-ink-muted">
          {tr('אפשר לחבר את האתר הקיים כדי לספור כמה גולשים נכנסו אליו ומאיפה הגיעו.')}
        </p>
        {/*
        <p className="text-sm text-ink-muted">
          {tr(
            'אפשר לחבר את האתר הקיים כך שכל פנייה מהטופס תיכנס לכאן כליד, יחד עם המודעה או הקמפיין שהביאו אותה (Google Ads, פייסבוק ועוד).',
          )}
        </p>
        */}
      </div>
      {info.isPending && <Spinner size="sm" label={tr('טוענים…')} />}
      {info.isError && <Alert tone="danger">{errorMessage(info.error)}</Alert>}
      {info.data && (
        <Steps>
          <Step>
            {tr(
              'הדביקו את השורה הזו באתר, לפני סגירת התגית </body> (או בתיבת "קוד מותאם" של בונה האתרים):',
            )}
            <Paste text={info.data.snippet} />
          </Step>
          {/*
          <Step>
            {tr(
              'בטופס יצירת הקשר הוסיפו לתגית form את data-simplecatch. השדות מזוהים לפי השם: name, phone, email, message ו-consent (תיבת אישור):',
            )}
            <Paste text={FORM_EXAMPLE} />
          </Step>
          <Step>
            {tr(
              'רוצים לספור לחיצות על כפתור מסוים (למשל "קבע תור")? הוסיפו לכפתור שם, ותראו אותו בדוחות:',
            )}
            <Paste text={CTA_EXAMPLE} />
            {tr(
              'בונה אתרים שלא מאפשר להוסיף תכונות? כתבו על תגית הסקריפט data-track עם רשימה של מסמן=שם, מופרדים בנקודה-פסיק:',
            )}
            <Paste text={TRACK_EXAMPLE} />
          </Step>
          <Step>
            {tr(
              'רוצים לדעת אילו חלקים בדף הגולשים באמת רואים (מחירון, שאלות נפוצות...)? תנו שם לחלק, ונספור כשהוא היה על המסך לפחות חצי שנייה:',
            )}
            <Paste text={SECTION_EXAMPLE} />
            {tr('או, בלי לגעת באתר עצמו, כתבו על תגית הסקריפט:')}
            <Paste text={SECTIONS_TRACK_EXAMPLE} />
          </Step>
          <Step>
            {tr(
              'לכל מודעה הוסיפו סימון בקישור (ראו "חיבור המודעות" בדוחות). הסקריפט שומר אותו 30 יום בדפדפן של המבקר, ושולח אותו עם הפנייה.',
            )}
          </Step>
          */}
        </Steps>
      )}
      {/*
      {info.data && (
        <div className="flex flex-col gap-3 rounded-2xl bg-surface-muted p-4">
          <h3 className="text-sm font-semibold text-ink">{tr('חנות Shopify')}</h3>
          <Steps>
            <Step>
              {tr(
                'בניהול Shopify: Online Store ← Themes ← ⋯ ← Edit code, ופתחו את הקובץ layout/theme.liquid.',
              )}
            </Step>
            <Step>
              {tr(
                'הדביקו את השורה הזו לפני </body>. היא סופרת כניסות לחנות, ושולחת אלינו כל פנייה מטופס "צור קשר" (ובנוסף ממשיכה לשלוח אותה גם ל-Shopify):',
              )}
              <Paste text={shopifySnippet(info.data)} />
            </Step>
          </Steps>
          <p className="text-xs text-ink-muted">
            {tr(
              'כדי שהפנייה תתקבל כליד צריך שהטלפון בטופס יהיה שדה חובה (בערכות רבות הוא רשות), ושהטופס יסביר שמשאירים פרטים ליצירת קשר. כניסות נספרות בחנות עצמה; דף התשלום של Shopify חסום לסקריפטים חיצוניים.',
            )}
          </p>
        </div>
      )}
      */}
      <p className="text-xs text-ink-muted">
        {tr(
          'הסקריפט לא אוסף פרטים אישיים: רק את שם הקמפיין, הקישור המפנה והדף. ערך מזהה הקליק (gclid) לא נשמר.',
        )}
      </p>
    </Card>
  );
}
