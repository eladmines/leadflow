import type { Business } from '@leadflow/shared';
import { ArrowRight, Globe, Sparkles, type LucideIcon } from 'lucide-react';
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

  // Each answer has its own colour (D-135): its icon tile, and the card once picked.
  const options: {
    value: Choice;
    label: string;
    hint: string;
    icon: LucideIcon;
    tile: string;
    picked: string;
  }[] = [
    {
      value: 'existing',
      icon: Globe,
      tile: 'bg-sky-500',
      picked: 'border-sky-300 bg-sky-50',
      label: tr('כן, יש לי כבר אתר'),
      hint: tr('מוסיפים את הכתובת ורואים את האתר כאן. LeadFlow לא משנה בו כלום.'),
    },
    {
      value: 'build',
      icon: Sparkles,
      tile: 'bg-violet-500',
      picked: 'border-violet-300 bg-violet-50',
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
        className="relative flex max-w-2xl flex-col gap-5 overflow-hidden rounded-2xl border border-surface-border bg-surface p-6 pt-7 shadow-card"
      >
        <span
          aria-hidden
          className="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-sky-400 via-brand-500 to-violet-500"
        />
        {step === 1 ? (
          <>
            <StepBar step={1} />
            <fieldset className="flex flex-col gap-3">
              <legend className="mb-3 text-lg font-semibold text-ink">
                {tr('יש לכם כבר אתר?')}
              </legend>
              {options.map(({ value, label, hint, icon: Icon, tile, picked }) => (
                <label
                  key={value}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 rounded-xl border p-4 transition-colors',
                    choice === value ? picked : 'border-surface-border hover:bg-surface-muted',
                  )}
                >
                  <input
                    type="radio"
                    name="site-start"
                    value={value}
                    checked={choice === value}
                    onChange={() => setChoice(value)}
                    aria-describedby={`site-start-${value}`}
                    className="h-4 w-4 shrink-0 accent-brand-600"
                  />
                  <span
                    aria-hidden
                    className={cn(
                      'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white shadow-sm',
                      tile,
                    )}
                  >
                    <Icon className="h-5 w-5" />
                  </span>
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
            <div className="flex items-center gap-3">
              <span
                aria-hidden
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-sky-500 text-white shadow-sm"
              >
                <Globe className="h-5 w-5" />
              </span>
              <div className="flex flex-col gap-0.5">
                <h2 className="text-lg font-semibold text-ink">{tr('מה הכתובת של האתר שלכם?')}</h2>
                <p className="text-sm text-ink-muted">
                  {tr('אחרי השמירה תראו את האתר כאן. אפשר לשנות את הכתובת בכל זמן.')}
                </p>
              </div>
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
        <span className="h-1.5 rounded-full bg-gradient-to-r from-sky-400 to-brand-500 rtl:bg-gradient-to-l" />
        <span
          className={cn(
            'h-1.5 rounded-full',
            step === 2
              ? 'bg-gradient-to-r from-brand-500 to-violet-500 rtl:bg-gradient-to-l'
              : 'bg-surface-sunken',
          )}
        />
      </div>
    </div>
  );
}
