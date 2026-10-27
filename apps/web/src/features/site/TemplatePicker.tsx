import {
  buildTemplateDraft,
  renderSitePage,
  TEMPLATE_KEYS,
  templateForIndustry,
  templateInfo,
  type TemplateKey,
} from '@leadflow/shared';
import { useMemo, useState } from 'react';
import { Alert, Button } from '../../components/ui';
import { cn } from '../../lib/cn';
import { errorMessage } from '../auth/serverErrors';
import { useCurrentBusiness } from '../shell/CurrentBusiness';
import { PageHeader } from '../shell/PageHeader';
import { siteBusinessInfo, useCreateSite } from './api';
import { PreviewFrame } from './PreviewFrame';

/** First visit to "My site": choose a template; it's pre-filled with the business profile. */
export function TemplatePicker() {
  const business = useCurrentBusiness();
  const create = useCreateSite(business.id);
  const [chosen, setChosen] = useState<TemplateKey | null>(null);
  const info = siteBusinessInfo(business);
  const suggested = templateForIndustry(business.industry);
  const previews = useMemo(
    () =>
      Object.fromEntries(
        TEMPLATE_KEYS.map((k) => [k, renderSitePage(buildTemplateDraft(k, info), info)]),
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
      <PageHeader
        title="בואו נבנה את האתר שלך"
        description="בחרו תבנית. נמלא אותה מראש בפרטי העסק, ואחר כך תוכלו לשנות כל טקסט, צבע וסדר מקטעים."
      />
      {create.isError && <Alert tone="danger">{errorMessage(create.error)}</Alert>}
      <ul className="grid gap-6 md:grid-cols-2">
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
                title={`תצוגה מקדימה של תבנית ${templateInfo[key].label}`}
                scale={0.32}
                className="h-64 border-b border-surface-border"
              />
              <div className="flex flex-1 flex-col gap-3 p-6">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold text-ink">{templateInfo[key].label}</h2>
                  {key === suggested && (
                    <span className="rounded-full bg-accent-100 px-2.5 py-0.5 text-xs font-medium text-accent-700">
                      מומלץ לעסק שלך
                    </span>
                  )}
                </div>
                <p className="flex-1 text-sm text-ink-muted">{templateInfo[key].description}</p>
                <Button
                  variant={key === suggested ? 'primary' : 'secondary'}
                  loading={create.isPending && chosen === key}
                  disabled={create.isPending}
                  onClick={() => choose(key)}
                >
                  בחירת התבנית
                </Button>
              </div>
            </article>
          </li>
        ))}
      </ul>
    </>
  );
}
