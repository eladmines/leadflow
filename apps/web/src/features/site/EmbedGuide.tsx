import { Alert, Card, Spinner } from '../../components/ui';
import { Paste, Step, Steps } from '../reports/AdsGuideDialog';
import { errorMessage } from '../auth/serverErrors';
import { useEmbedInfo } from './embedApi';
import { tr } from '../../i18n';

const FORM_EXAMPLE = `<form data-simplecatch data-success="Thank you!">
  <input name="name" required>
  <input name="phone" required>
  <input name="email">
  <textarea name="message"></textarea>
  <label><input type="checkbox" name="consent" required> I agree to be contacted</label>
  <button type="submit">Send</button>
</form>`;

/**
 * F30: leads and ad tracking for a website built elsewhere. The owner pastes one script tag; forms
 * marked `data-simplecatch` then send their leads here, with the ad that brought each one.
 */
export function EmbedGuide({ businessId }: { businessId: string }) {
  const info = useEmbedInfo(businessId, true);
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-ink">{tr('קבלת פניות והמקור שלהן מהאתר')}</h2>
        <p className="text-sm text-ink-muted">
          {tr(
            'אפשר לחבר את האתר הקיים כך שכל פנייה מהטופס תיכנס לכאן כליד, יחד עם המודעה או הקמפיין שהביאו אותה (Google Ads, פייסבוק ועוד).',
          )}
        </p>
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
          <Step>
            {tr(
              'בטופס יצירת הקשר הוסיפו לתגית form את data-simplecatch. השדות מזוהים לפי השם: name, phone, email, message ו-consent (תיבת אישור):',
            )}
            <Paste text={FORM_EXAMPLE} />
          </Step>
          <Step>
            {tr(
              'לכל מודעה הוסיפו סימון בקישור (ראו "חיבור המודעות" בדוחות). הסקריפט שומר אותו 30 יום בדפדפן של המבקר, ושולח אותו עם הפנייה.',
            )}
          </Step>
        </Steps>
      )}
      <p className="text-xs text-ink-muted">
        {tr(
          'הסקריפט לא אוסף פרטים אישיים: רק את שם הקמפיין, הקישור המפנה והדף. ערך מזהה הקליק (gclid) לא נשמר.',
        )}
      </p>
    </Card>
  );
}
