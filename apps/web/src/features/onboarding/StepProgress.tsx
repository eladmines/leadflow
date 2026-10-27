import { ONBOARDING_STEPS } from '@leadflow/shared';
import { cn } from '../../lib/cn';

export const stepTitles = ['פרטי העסק', 'יצירת קשר', 'אזורי שירות', 'שעות פעילות'] as const;

/** "Step X of 4" with labelled segments. The current step is announced to screen readers. */
export function StepProgress({ step }: { step: number }) {
  return (
    <nav aria-label="שלבי הקמת העסק" className="flex flex-col gap-2">
      <p className="text-sm font-medium text-brand-700">
        שלב {step} מתוך {ONBOARDING_STEPS}
      </p>
      <ol className="grid grid-cols-4 gap-2">
        {stepTitles.map((title, i) => {
          const n = i + 1;
          return (
            <li
              key={title}
              aria-current={n === step ? 'step' : undefined}
              className="flex flex-col gap-1.5"
            >
              <span
                aria-hidden
                className={cn(
                  'h-1.5 rounded-full',
                  n <= step ? 'bg-brand-600' : 'bg-surface-border',
                )}
              />
              <span
                className={cn(
                  'hidden text-xs sm:block',
                  n === step ? 'font-semibold text-ink' : 'text-ink-muted',
                )}
              >
                {title}
                {n < step && <span className="sr-only"> (הושלם)</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
