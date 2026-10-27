import { ONBOARDING_STEPS } from '@leadflow/shared';
import { Check } from 'lucide-react';
import { cn } from '../../lib/cn';

export const stepTitles = ['פרטי העסק', 'יצירת קשר', 'אזורי שירות', 'שעות פעילות'] as const;

/** Numbered steps with connecting lines. The current step is announced to screen readers. */
export function StepProgress({ step }: { step: number }) {
  return (
    <nav aria-label="שלבי הקמת העסק" className="flex flex-col gap-3">
      <p className="text-sm font-medium text-accent-700">
        שלב {step} מתוך {ONBOARDING_STEPS}
      </p>
      <ol className="flex items-start">
        {stepTitles.map((title, i) => {
          const n = i + 1;
          const done = n < step;
          const current = n === step;
          return (
            <li
              key={title}
              aria-current={current ? 'step' : undefined}
              className="flex flex-1 flex-col items-center gap-2 text-center"
            >
              <div className="flex w-full items-center">
                <span
                  aria-hidden
                  className={cn(
                    'h-0.5 flex-1',
                    i === 0 ? 'invisible' : n <= step ? 'bg-brand-500' : 'bg-surface-border',
                  )}
                />
                <span
                  aria-hidden
                  className={cn(
                    'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold transition-colors',
                    done && 'bg-brand-600 text-white',
                    current && 'bg-accent-500 text-white ring-4 ring-accent-100',
                    !done && !current && 'bg-surface text-ink-subtle ring-1 ring-surface-border',
                  )}
                >
                  {done ? <Check className="h-4 w-4" strokeWidth={3} /> : n}
                </span>
                <span
                  aria-hidden
                  className={cn(
                    'h-0.5 flex-1',
                    i === stepTitles.length - 1
                      ? 'invisible'
                      : n < step
                        ? 'bg-brand-500'
                        : 'bg-surface-border',
                  )}
                />
              </div>
              <span
                className={cn(
                  'hidden text-xs sm:block',
                  current ? 'font-semibold text-ink' : 'text-ink-muted',
                )}
              >
                {title}
                {done && <span className="sr-only"> (הושלם)</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
