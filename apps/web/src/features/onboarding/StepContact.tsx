import { zodResolver } from '@hookform/resolvers/zod';
import {
  formatIsraeliPhone,
  onboardingContactSchema,
  type Business,
  type OnboardingContact,
} from '@leadflow/shared';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Alert, Button, Field } from '../../components/ui';
import { applyServerErrors } from '../auth/serverErrors';

interface Props {
  business: Business;
  onSubmit: (values: OnboardingContact) => Promise<void>;
  onBack: () => void;
}

/** Step 2: phone (required to finish) + address (optional). */
export function StepContact({ business, onSubmit, onBack }: Props) {
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<OnboardingContact>({
    resolver: zodResolver(onboardingContactSchema),
    mode: 'onTouched',
    defaultValues: {
      phone: business.phone ? formatIsraeliPhone(business.phone) : '',
      address: business.address ?? '',
    },
  });
  const { errors, isSubmitting } = form.formState;

  const submit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await onSubmit(values);
    } catch (err) {
      setFormError(applyServerErrors(err, form.setError, ['phone', 'address']));
    }
  });

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-ink">איך לקוחות יכולים להגיע אליך?</h1>
        <p className="text-sm text-ink-muted">הטלפון יופיע באתר ובפניות. הכתובת אינה חובה.</p>
      </header>
      {formError && <Alert tone="danger">{formError}</Alert>}
      <Field
        label="טלפון העסק"
        required
        ltr
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        placeholder="050-1234567"
        error={errors.phone?.message}
        {...form.register('phone')}
      />
      <Field
        label="כתובת"
        autoComplete="street-address"
        placeholder="רחוב, מספר ועיר"
        hint="לעסקים שמקבלים לקוחות במקום"
        error={errors.address?.message}
        {...form.register('address')}
      />
      <div className="flex justify-between gap-3">
        <Button variant="ghost" onClick={onBack} disabled={isSubmitting}>
          חזרה
        </Button>
        <Button type="submit" loading={isSubmitting}>
          המשך
        </Button>
      </div>
    </form>
  );
}
