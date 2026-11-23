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

/**
 * F30: the website's own form also becomes a lead. Three short steps; the form itself is not touched
 * and keeps sending as before (a copy comes here). Fields are found by themselves.
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
              'הטופס באתר ממשיך לשלוח כרגיל. אנחנו מקבלים עותק של כל פנייה, והיא נכנסת לדף "לידים".',
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
        <div id="site-form-leads-guide" className="flex flex-col gap-4">
          {info.isPending && <Spinner size="sm" label={tr('טוענים…')} />}
          {info.isError && <Alert tone="danger">{errorMessage(info.error)}</Alert>}
          {info.data && (
            <>
              <Steps>
                <Step>{tr('הדביקו באתר את השורה מהכרטיס שמעל (אם עוד לא).')}</Step>
                <Step>
                  {tr('הוסיפו לשורה הזו את המזהה (id) של הטופס, במקום contact-form:')}
                  <Paste text='data-forms="#contact-form"' />
                  <span className="text-xs text-ink-muted">
                    {tr('בטופס צריך לפחות שם וטלפון. את השאר אנחנו מזהים לבד.')}
                  </span>
                </Step>
                <Step>
                  {tr('שלחו פנייה לדוגמה מהאתר, ובדקו שהיא מופיעה ב')}
                  <Link
                    to={businessWebPaths.section(business.id, 'leads')}
                    className="font-medium text-brand-700 underline"
                  >
                    {tr('דף הלידים')}
                  </Link>
                  .
                </Step>
              </Steps>
              <p className="text-xs text-ink-muted">
                {tr(
                  'ב-Shopify: במקום השורה הרגילה הדביקו את השורה הזו, והיא מחברת את טופס "צור קשר":',
                )}
              </p>
              <Paste text={shopifySnippet(info.data)} />
            </>
          )}
        </div>
      )}
    </Card>
  );
}
