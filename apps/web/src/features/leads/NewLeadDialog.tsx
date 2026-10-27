import { zodResolver } from '@hookform/resolvers/zod';
import {
  businessWebPaths,
  can,
  createLeadRequestSchema,
  formatIsraeliPhone,
  normalizeIsraeliPhone,
  type CreateLeadRequest,
} from '@leadflow/shared';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, DialogShell, Field, Select, Textarea } from '../../components/ui';
import { applyServerErrors } from '../auth/serverErrors';
import { useMembers } from '../businesses/api';
import { useCurrentBusiness } from '../shell/CurrentBusiness';
import { useCreateLead, useDuplicates, usePipeline } from './api';

/** Manual lead with a duplicate warning (same phone/email) before saving. */
export function NewLeadDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const business = useCurrentBusiness();
  const navigate = useNavigate();
  const create = useCreateLead(business.id);
  const stages = usePipeline(business.id);
  const canAssign = can(business.role, 'leads.assign');
  const members = useMembers(business.id, open && canAssign);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<CreateLeadRequest>({
    resolver: zodResolver(createLeadRequestSchema),
    mode: 'onTouched',
    defaultValues: { name: '', phone: '', email: '', message: '' },
  });
  const { errors, isSubmitting } = form.formState;

  // Check duplicates once the phone/email look complete.
  const phone = form.watch('phone') ?? '';
  const email = form.watch('email') ?? '';
  const phoneE164 = normalizeIsraeliPhone(phone) ?? '';
  const emailOk = /^\S+@\S+\.\S+$/.test(email) ? email : '';
  const duplicates = useDuplicates(business.id, phoneE164, emailOk, open);

  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) {
      form.reset();
      setFormError(null);
    }
  };

  const submit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      const { lead } = await create.mutateAsync(values);
      close(false);
      navigate(`${businessWebPaths.section(business.id, 'leads')}/${lead.id}`);
    } catch (err) {
      setFormError(
        applyServerErrors(err, form.setError, [
          'name',
          'phone',
          'email',
          'message',
          'stageId',
          'ownerId',
        ]),
      );
    }
  });

  return (
    <DialogShell open={open} onOpenChange={close} title="ליד חדש">
      <form noValidate onSubmit={submit} className="flex flex-col gap-4">
        {formError && <Alert tone="danger">{formError}</Alert>}
        <Field
          label="שם"
          required
          autoComplete="off"
          error={errors.name?.message}
          {...form.register('name')}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="טלפון"
            ltr
            type="tel"
            inputMode="tel"
            error={errors.phone?.message}
            {...form.register('phone')}
          />
          <Field
            label="אימייל"
            ltr
            type="email"
            error={errors.email?.message}
            {...form.register('email')}
          />
        </div>
        {duplicates.data && duplicates.data.length > 0 && (
          <Alert tone="warning" title="כבר קיים איש קשר עם הפרטים האלה">
            <ul className="mt-1 list-disc ps-5">
              {duplicates.data.map((c) => (
                <li key={c.id}>
                  {c.name}
                  {c.phone && (
                    <>
                      {' · '}
                      <bdi dir="ltr">{formatIsraeliPhone(c.phone)}</bdi>
                    </>
                  )}{' '}
                  ({c.leadCount} פניות)
                </li>
              ))}
            </ul>
            <p className="mt-1">אפשר להמשיך: הליד החדש יתווסף לאותו איש קשר, וההיסטוריה תישמר.</p>
          </Alert>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="שלב"
            options={(stages.data ?? []).map((s) => ({ value: s.id, label: s.name }))}
            {...form.register('stageId', { setValueAs: (v: string) => v || undefined })}
          />
          {canAssign && (
            <Select
              label="אחראי"
              options={[
                { value: '', label: 'ללא אחראי' },
                ...(members.data ?? []).map((m) => ({ value: m.userId, label: m.fullName })),
              ]}
              error={errors.ownerId?.message}
              {...form.register('ownerId', { setValueAs: (v: string) => v || null })}
            />
          )}
        </div>
        <Textarea
          label="פרטי הפנייה"
          rows={3}
          error={errors.message?.message}
          {...form.register('message')}
        />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => close(false)}>
            ביטול
          </Button>
          <Button type="submit" loading={isSubmitting}>
            יצירת ליד
          </Button>
        </div>
      </form>
    </DialogShell>
  );
}
