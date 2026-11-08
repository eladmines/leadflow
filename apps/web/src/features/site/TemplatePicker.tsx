import {
  renderSitePage,
  TEMPLATE_KEYS,
  templateForIndustry,
  templateInfo,
  templatePreview,
  type TemplateKey,
} from '@leadflow/shared';
import { useMemo, useState, type ReactNode } from 'react';
import { Alert, Button } from '../../components/ui';
import { cn } from '../../lib/cn';
import { errorMessage } from '../auth/serverErrors';
import { useCurrentBusiness } from '../shell/CurrentBusiness';
import { PageHeader } from '../shell/PageHeader';
import { siteBusinessInfo, useCreateSite } from './api';
import { PreviewFrame } from './PreviewFrame';
import { tr } from '../../i18n';

/**
 * First visit to "My site": choose a template; it's pre-filled with the business profile.
 * `intro` sits under the page header; `secondary` shows the picker below an existing website
 * (D-094) with a section heading in place of the page header.
 */
export function TemplatePicker({
  intro,
  secondary = false,
}: { intro?: ReactNode; secondary?: boolean } = {}) {
  const business = useCurrentBusiness();
  const create = useCreateSite(business.id);
  const [chosen, setChosen] = useState<TemplateKey | null>(null);
  const info = siteBusinessInfo(business);
  const suggested = templateForIndustry(business.industry);
  const previews = useMemo(
    () =>
      Object.fromEntries(
        TEMPLATE_KEYS.map((k) => {
          // Shown with the sample photos the new site will start with (D-069).
          const { draft, media } = templatePreview(k, info, '', business.language);
          return [k, renderSitePage(draft, info, media)];
        }),
      ) as Record<TemplateKey, string>,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [business.id],
  );

  const choose = (key: TemplateKey) => {
    setChosen(key);
    create.mutate({ templateKey: key });
  };

  return (
    <>
      {secondary ? (
        <div className="flex flex-col gap-1 pt-2">
          <h2 className="text-lg font-semibold text-ink">{tr('רוצים אתר חדש ב-LeadFlow?')}</h2>
          <p className="text-sm text-ink-muted">
            {tr(
              'אתר שמנוהל כאן: פניות נכנסות ישר למערכת, ועורכים הכול לבד. בחרו תבנית כדי להתחיל. האתר הקיים לא ישתנה.',
            )}
          </p>
        </div>
      ) : (
        <PageHeader
          title={tr('בואו נבנה את האתר שלך')}
          description={tr(
            'בחרו תבנית. נמלא אותה מראש בפרטי העסק ובתמונות לדוגמה, ואחר כך תוכלו לשנות כל טקסט, תמונה, צבע וסדר מקטעים.',
          )}
        />
      )}
      {intro}
      {create.isError && <Alert tone="danger">{errorMessage(create.error)}</Alert>}
      <ul className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {[suggested, ...TEMPLATE_KEYS.filter((k) => k !== suggested)].map((key) => (
          <li key={key}>
            <article
              className={cn(
                'flex h-full flex-col overflow-hidden rounded-3xl border bg-surface shadow-card transition-shadow hover:shadow-lift',
                key === suggested ? 'border-brand-200' : 'border-surface-border',
              )}
            >
              <PreviewFrame
                html={previews[key]}
                title={tr('תצוגה מקדימה של תבנית {0}', tr(templateInfo[key].label))}
                scale={0.32}
                className="h-64 border-b border-surface-border"
              />
              <div className="flex flex-1 flex-col gap-3 p-6">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold text-ink">{tr(templateInfo[key].label)}</h2>
                  {key === suggested && (
                    <span className="rounded-full bg-accent-100 px-2.5 py-0.5 text-xs font-medium text-accent-700">
                      {tr('מומלץ לעסק שלך')}
                    </span>
                  )}
                </div>
                <p className="flex-1 text-sm text-ink-muted">{tr(templateInfo[key].description)}</p>
                <Button
                  variant={key === suggested ? 'primary' : 'secondary'}
                  loading={create.isPending && chosen === key}
                  disabled={create.isPending}
                  onClick={() => choose(key)}
                >
                  {tr('בחירת התבנית')}
                </Button>
              </div>
            </article>
          </li>
        ))}
      </ul>
    </>
  );
}
