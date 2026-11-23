import { businessWebPaths } from '@simplecatch/shared';
import { Link } from 'react-router-dom';
import { Alert, Card, CollapseButton, Spinner } from '../../components/ui';
import { useCollapsed } from '../../lib/useCollapsed';
import { Paste, Step, Steps } from '../reports/AdsGuideDialog';
import { errorMessage } from '../auth/serverErrors';
import { useCurrentBusiness } from '../shell/CurrentBusiness';
import { shopifySnippet } from './EmbedGuide';
import { useEmbedInfo } from './embedApi';
import { tr } from '../../i18n';

const FORM_TAG = '<form data-simplecatch>';
const FORMS_ATTR = 'data-forms="#contact-form"';
const COPY_ATTR = 'data-forms="#contact-form" data-copy';

/**
 * F30: the website's own form becomes leads, without rebuilding it. The script finds the name, phone,
 * email and message by their type, name and label (Hebrew or English); the owner only says which form.
 */
export function FormLeadsGuide({ businessId }: { businessId: string }) {
  const info = useEmbedInfo(businessId, true);
  const business = useCurrentBusiness();
  const [hidden, toggle] = useCollapsed('site-form-leads-guide');
  return (
    <Card className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold text-ink">{tr('לידים מהטופס שלכם')}</h2>
          <p className="text-sm text-ink-muted">
            {tr(
              'הטופס באתר נשאר כמו שהוא. אנחנו מזהים בו לבד שם, טלפון, מייל והודעה, והפנייה נכנסת לדף "לידים" עם המקור שלה.',
            )}
          </p>
        </div>
        <CollapseButton
          collapsed={hidden}
          onToggle={toggle}
          controls="site-form-leads-guide"
          label={tr('לידים מהטופס שלכם')}
        />
      </div>
      {!hidden && (
        <div id="site-form-leads-guide" className="flex flex-col gap-5">
          {info.isPending && <Spinner size="sm" label={tr('טוענים…')} />}
          {info.isError && <Alert tone="danger">{errorMessage(info.error)}</Alert>}
          {info.data && (
            <Steps>
              <Step>
                {tr('ודאו שהדבקתם באתר את השורה מהכרטיס שמעל (קבלת פניות והמקור שלהן מהאתר).')}
              </Step>
              <Step>
                {tr(
                  'אמרו לנו איזה טופס לקלוט. הדרך הפשוטה: בתגית form של הטופס הוסיפו את המילה הזו:',
                )}
                <Paste text={FORM_TAG} />
                {tr(
                  'אי אפשר לשנות את הטופס? על שורת הסקריפט כתבו את המזהה (id) של הטופס, כך (במקום contact-form):',
                )}
                <Paste text={FORMS_ATTR} />
              </Step>
              <Step>
                {tr(
                  'הטופס שולח את עצמו בדרך אחרת (מייל, שירות חיצוני) ואתם רוצים שהוא ימשיך כרגיל? הוסיפו data-copy. נשלח לכאן עותק של הפנייה, ושום דבר בטופס או בדף לא משתנה:',
                )}
                <Paste text={COPY_ATTR} />
              </Step>
              <Step>
                {tr('מה אנחנו מזהים לבד:')}
                <ul className="list-disc ps-5 text-sm text-ink">
                  <li>
                    {tr(
                      'שם: שדה עם "שם" בתווית או בשם, או autocomplete="name". שם פרטי ושם משפחה מתחברים.',
                    )}
                  </li>
                  <li>
                    {tr('טלפון: שדה מסוג טלפון (type="tel"), או עם "טלפון" או "נייד" בתווית.')}
                  </li>
                  <li>{tr('מייל: שדה מסוג מייל, או עם "מייל" בתווית.')}</li>
                  <li>{tr('הודעה: תיבת טקסט גדולה (textarea).')}</li>
                  <li>{tr('שדות נוספים, כמו תאריך האירוע, מצורפים להודעה עם שם השדה.')}</li>
                  <li>{tr('שדה מוסתר שרק בוטים ממלאים מזוהה, ופנייה כזו נזרקת.')}</li>
                </ul>
              </Step>
              <Step>
                {tr(
                  'שני דברים שחשוב לדעת: טלפון חובה (בלעדיו הפנייה לא תיכנס, כי ליד מזוהה לפי טלפון). ואם בטופס יש תיבת אישור והיא לא מסומנת, הפנייה לא תיכנס. בטופס בלי תיבת אישור, שליחת הטופס נחשבת בקשה שיחזרו אליכם.',
                )}
              </Step>
              <Step>
                {tr('בדקו: שלחו פנייה לדוגמה מהאתר, ובדקו שהיא מופיעה ב')}
                <Link
                  to={businessWebPaths.section(business.id, 'leads')}
                  className="font-medium text-brand-700 underline"
                >
                  {tr('דף הלידים')}
                </Link>
                .
              </Step>
            </Steps>
          )}
          {info.data && (
            <div className="flex flex-col gap-2 rounded-2xl bg-surface-muted p-4">
              <h3 className="text-sm font-semibold text-ink">Shopify</h3>
              <p className="text-sm text-ink">
                {tr(
                  'ב-Shopify לא צריך לסמן את הטופס: במקום השורה הרגילה הדביקו את השורה הזו, והיא מחברת את טופס "צור קשר" לבד (הפנייה ממשיכה להגיע גם ל-Shopify):',
                )}
              </p>
              <Paste text={shopifySnippet(info.data)} />
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
