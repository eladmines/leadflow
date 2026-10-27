import { weekdayLabels, WEEKDAYS, type OpeningHours } from '@leadflow/shared';
import type { UseFormReturn } from 'react-hook-form';
import { cn } from '../../lib/cn';

const timeInput =
  'h-10 w-28 rounded-lg border bg-surface px-2 text-center text-base text-ink disabled:bg-surface-muted disabled:text-ink-subtle sm:text-sm';

/** Weekly opening hours (Sunday first). Bind to a react-hook-form over `openingHoursSchema`. */
export function HoursFields({
  form,
  disabled,
}: {
  form: UseFormReturn<OpeningHours>;
  disabled?: boolean;
}) {
  const values = form.watch();
  const { errors } = form.formState;

  return (
    <fieldset
      disabled={disabled}
      className="flex flex-col divide-y divide-surface-border rounded-xl border border-surface-border"
    >
      <legend className="sr-only">שעות פעילות לפי ימים</legend>
      {WEEKDAYS.map((day) => {
        const open = values[day]?.open;
        const err = errors[day]?.to?.message ?? errors[day]?.from?.message;
        const errId = `hours-${day}-error`;
        return (
          <div key={day} className="flex flex-col gap-1 px-3 py-3 sm:px-4">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <label className="flex w-28 cursor-pointer items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-brand-600"
                  {...form.register(`${day}.open`)}
                />
                {weekdayLabels[day]}
              </label>
              {open ? (
                <div className="flex items-center gap-2" dir="ltr">
                  {(['from', 'to'] as const).map((edge, i) => (
                    <span key={edge} className="contents">
                      {i === 1 && (
                        <span aria-hidden className="text-ink-muted">
                          –
                        </span>
                      )}
                      <input
                        type="time"
                        aria-label={`${edge === 'from' ? 'שעת פתיחה' : 'שעת סגירה'} ביום ${weekdayLabels[day]}`}
                        aria-invalid={err ? true : undefined}
                        aria-describedby={err ? errId : undefined}
                        className={cn(
                          timeInput,
                          err ? 'border-danger-600' : 'border-surface-border',
                        )}
                        {...form.register(`${day}.${edge}`)}
                      />
                    </span>
                  ))}
                </div>
              ) : (
                <span className="text-sm text-ink-muted">סגור</span>
              )}
            </div>
            {open && err && (
              <p id={errId} className="text-xs text-danger-600">
                {err}
              </p>
            )}
          </div>
        );
      })}
    </fieldset>
  );
}
