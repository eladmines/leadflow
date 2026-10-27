import { zodResolver } from '@hookform/resolvers/zod';
import {
  defaultOpeningHours,
  openingHoursSchema,
  weekdayLabels,
  WEEKDAYS,
  type Business,
  type OpeningHours,
} from '@leadflow/shared';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Alert, Button } from '../../components/ui';
import { cn } from '../../lib/cn';
import { errorMessage } from '../auth/serverErrors';

interface Props {
  business: Business;
  onSubmit: (hours: OpeningHours) => Promise<void>;
  onBack: () => void;
}

const timeInput =
  'h-10 w-28 rounded-lg border bg-surface px-2 text-center text-base text-ink disabled:bg-surface-muted disabled:text-ink-subtle sm:text-sm';

/** Step 4: weekly opening hours (Sunday first, as in Israel). Finishing activates the business. */
export function StepHours({ business, onSubmit, onBack }: Props) {
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<OpeningHours>({
    resolver: zodResolver(openingHoursSchema),
    mode: 'onTouched',
    defaultValues: business.openingHours ?? defaultOpeningHours,
  });
  const { errors, isSubmitting } = form.formState;
  const values = form.watch();

  const submit = form.handleSubmit(async (hours) => {
    setFormError(null);
    try {
      await onSubmit(hours);
    } catch (err) {
      setFormError(errorMessage(err));
    }
  });

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-ink">מתי העסק פתוח?</h1>
        <p className="text-sm text-ink-muted">
          השעות יוצגו באתר ויעזרו בהמשך בניהול תורים. מילאנו הצעה — עדכנו לפי הצורך.
        </p>
      </header>
      {formError && <Alert tone="danger">{formError}</Alert>}

      <fieldset className="flex flex-col divide-y divide-surface-border rounded-xl border border-surface-border">
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
                    <input
                      type="time"
                      aria-label={`שעת פתיחה ביום ${weekdayLabels[day]}`}
                      aria-invalid={err ? true : undefined}
                      aria-describedby={err ? errId : undefined}
                      className={cn(timeInput, err ? 'border-danger-600' : 'border-surface-border')}
                      {...form.register(`${day}.from`)}
                    />
                    <span aria-hidden className="text-ink-muted">
                      –
                    </span>
                    <input
                      type="time"
                      aria-label={`שעת סגירה ביום ${weekdayLabels[day]}`}
                      aria-invalid={err ? true : undefined}
                      aria-describedby={err ? errId : undefined}
                      className={cn(timeInput, err ? 'border-danger-600' : 'border-surface-border')}
                      {...form.register(`${day}.to`)}
                    />
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

      <div className="flex justify-between gap-3">
        <Button variant="ghost" onClick={onBack} disabled={isSubmitting}>
          חזרה
        </Button>
        <Button type="submit" loading={isSubmitting}>
          סיום והמשך למערכת
        </Button>
      </div>
    </form>
  );
}
