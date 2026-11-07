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
 * "My website" before there is one, as two short steps (D-130, D-132, D-134): first "do you already
 * have a website?", then either its address or a template to build from.
 */
export function SiteStart({ business }: { business: Business }) {
  const [choice, setChoice] = useState<Choice | null>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const back = () => setStep(1);

  if (step === 2 && choice === 'build') {
    return <TemplatePicker intro={<StepBar step={2} onBack={back} />} />;
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
      <PageHeader
        title={tr('האתר שלי')}
        description={tr(
          'האתר הוא הכרטיס של העסק באינטרנט: לקוחות רואים מה אתם מציעים, איך להגיע ואיך ליצור קשר. כל מי שממלא בו את הטופס מגיע ישר ל"לקוחות ולידים", כך שאף פנייה לא הולכת לאיבוד.',
        )}
      />
      <section
        id="site-start"
        className="flex max-w-2xl flex-col gap-5 rounded-2xl border border-surface-border bg-surface p-6 shadow-card"
      >
        {step === 1 ? (
          <>
            <StepBar step={1} />
            <fieldset className="flex flex-col gap-3">
              <legend className="mb-3 text-lg font-semibold text-ink">
                {tr('יש לכם כבר אתר?')}
              </legend>
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
            <Button className="self-end" disabled={!choice} onClick={() => setStep(2)}>
              {tr('המשך')}
            </Button>
          </>
        ) : (
          <>
            <StepBar step={2} onBack={back} />
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-semibold text-ink">{tr('מה הכתובת של האתר שלכם?')}</h2>
              <p className="text-sm text-ink-muted">
                {tr('אחרי השמירה תראו את האתר כאן. אפשר לשנות את הכתובת בכל זמן.')}
              </p>
            </div>
            <WebsiteForm business={business} compact />
          </>
        )}
      </section>
    </>
  );
}

/** "Step 1 of 2", a two-part bar, and on step 2 the way back. */
function StepBar({ step, onBack }: { step: 1 | 2; onBack?: () => void }) {
  return (
    <div className="flex w-full max-w-2xl flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-ink-muted">{tr('שלב {0} מתוך {1}', step, 2)}</p>
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline"
          >
            {/* Back points to the start side: right in Hebrew, left in English. */}
            <ArrowRight aria-hidden className="h-4 w-4 ltr:rotate-180" />
            {tr('חזרה')}
          </button>
        )}
      </div>
      <div aria-hidden className="grid grid-cols-2 gap-1.5">
        <span className="h-1.5 rounded-full bg-brand-600" />
        <span className={cn('h-1.5 rounded-full', step === 2 ? 'bg-brand-600' : 'bg-brand-100')} />
      </div>
    </div>
  );
}
