import { zodResolver } from '@hookform/resolvers/zod';
import {
  defaultOpeningHours,
  openingHoursSchema,
  type Business,
  type OpeningHours,
} from '@leadflow/shared';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Alert, Button } from '../../components/ui';
import { errorMessage } from '../auth/serverErrors';
import { HoursFields } from '../businesses/HoursFields';

interface Props {
  business: Business;
  onSubmit: (hours: OpeningHours) => Promise<void>;
  onBack: () => void;
}

/** Step 4: weekly opening hours. Finishing activates the business. */
export function StepHours({ business, onSubmit, onBack }: Props) {
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<OpeningHours>({
    resolver: zodResolver(openingHoursSchema),
    mode: 'onTouched',
    defaultValues: business.openingHours ?? defaultOpeningHours,
  });

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
      <HoursFields form={form} />
      <div className="flex justify-between gap-3">
        <Button variant="ghost" onClick={onBack} disabled={form.formState.isSubmitting}>
          חזרה
        </Button>
        <Button type="submit" loading={form.formState.isSubmitting}>
          סיום והמשך למערכת
        </Button>
      </div>
    </form>
  );
}
