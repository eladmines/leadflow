import { zodResolver } from '@hookform/resolvers/zod';
import {
  createBusinessRequestSchema,
  INDUSTRIES,
  industryLabels,
  type Business,
  type CreateBusinessRequest,
} from '@leadflow/shared';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Alert, Button, Field, Select } from '../../components/ui';
import { applyServerErrors } from '../auth/serverErrors';

const industryOptions = INDUSTRIES.map((value) => ({ value, label: industryLabels[value] }));

interface Props {
  /** Existing business when returning to step 1; undefined on first creation. */
  business?: Business;
  onSubmit: (values: CreateBusinessRequest) => Promise<void>;
}

/** Step 1: business name + industry. Creates the business, or updates it when going back. */
export function StepBusiness({ business, onSubmit }: Props) {
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<CreateBusinessRequest>({
    resolver: zodResolver(createBusinessRequestSchema),
    mode: 'onTouched',
    defaultValues: {
      name: business?.name ?? '',
      industry: business?.industry ?? ('' as CreateBusinessRequest['industry']),
    },
  });
  const { errors, isSubmitting } = form.formState;

  const submit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await onSubmit(values);
    } catch (err) {
      setFormError(applyServerErrors(err, form.setError, ['name', 'industry']));
    }
  });

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-ink">בואו נכיר את העסק שלך</h1>
        <p className="text-sm text-ink-muted">
          השם והתחום יעזרו לנו להציע לך תבנית אתר מתאימה. אפשר לשנות אותם בכל שלב.
        </p>
      </header>
      {formError && <Alert tone="danger">{formError}</Alert>}
      <Field
        label="שם העסק"
        required
        autoComplete="organization"
        placeholder="לדוגמה: מספרת שירן"
        hint="כפי שהלקוחות מכירים אותו"
        error={errors.name?.message}
        {...form.register('name')}
      />
      <Select
        label="תחום פעילות"
        required
        placeholder="בחירת תחום"
        options={industryOptions}
        error={errors.industry?.message}
        {...form.register('industry')}
      />
      <div className="flex justify-end">
        <Button type="submit" loading={isSubmitting}>
          המשך
        </Button>
      </div>
    </form>
  );
}
