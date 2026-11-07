import type { Business } from '@leadflow/shared';
import { ArrowRight } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../components/ui';
import { cn } from '../../lib/cn';
import { PageHeader } from '../shell/PageHeader';
import { WebsiteForm } from './ExistingWebsite';
import { TemplatePicker } from './TemplatePicker';
import { tr } from '../../i18n';

type Choice = 'existing' | 'build';

/**
 * "My website" before there is one (D-130, D-132): one short form — does the business already
 * have a website? Yes → its address, right there; no → pick a template.
 */
export function SiteStart({ business }: { business: Business }) {
  const [choice, setChoice] = useState<Choice | null>(null);
  const [picking, setPicking] = useState(false);

  if (picking) {
    return (
      <TemplatePicker
        intro={
          <button
            type="button"
            onClick={() => setPicking(false)}
            className="inline-flex items-center gap-1.5 self-start text-sm font-medium text-brand-700 hover:underline"
          >
            {/* Back points to the start side: right in Hebrew, left in English. */}
            <ArrowRight aria-hidden className="h-4 w-4 ltr:rotate-180" />
            {tr('חזרה לבחירה')}
          </button>
        }
      />
    );
  }

  const options: { value: Choice; label: string; hint: string }[] = [
    {
      value: 'existing',
      label: tr('כן, יש לי כבר אתר'),
      hint: tr('מוסיפים את הכתובת ורואים את האתר כאן. LeadFlow לא משנה בו כלום.'),
    },
    {
      value: 'build',
      label: tr('לא, אני רוצה לבנות אתר'),
      hint: tr('בוחרים תבנית מוכנה, והיא מתמלאת בפרטי העסק.'),
    },
  ];

  return (
    <>
      <PageHeader title={tr('האתר שלי')} />
      <section
        id="site-start"
        className="flex max-w-2xl flex-col gap-5 rounded-2xl border border-surface-border bg-surface p-6 shadow-card"
      >
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-3 text-lg font-semibold text-ink">{tr('יש לכם כבר אתר?')}</legend>
          {options.map(({ value, label, hint }) => (
            <label
              key={value}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors',
                choice === value
                  ? 'border-brand-300 bg-brand-50/60'
                  : 'border-surface-border hover:bg-surface-muted',
              )}
            >
              <input
                type="radio"
                name="site-start"
                value={value}
                checked={choice === value}
                onChange={() => setChoice(value)}
                aria-describedby={`site-start-${value}`}
                className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600"
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-semibold text-ink">{label}</span>
                <span id={`site-start-${value}`} className="text-sm text-ink-muted">
                  {hint}
                </span>
              </span>
            </label>
          ))}
        </fieldset>

        {choice === 'existing' && <WebsiteForm business={business} compact />}
        {choice === 'build' && (
          <Button className="self-start" onClick={() => setPicking(true)}>
            {tr('לבחירת תבנית')}
          </Button>
        )}
      </section>
    </>
  );
}
