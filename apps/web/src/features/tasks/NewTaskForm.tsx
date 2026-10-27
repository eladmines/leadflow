import { zodResolver } from '@hookform/resolvers/zod';
import { can, createTaskRequestSchema } from '@leadflow/shared';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Alert, Button, Field, Select } from '../../components/ui';
import { applyServerErrors } from '../auth/serverErrors';
import { useMembers } from '../businesses/api';
import { useCurrentBusiness } from '../shell/CurrentBusiness';
import { defaultDueLocal, useCreateTask } from './api';

/** Form values: due time as the `datetime-local` string; converted to ISO on submit. */
const formSchema = createTaskRequestSchema.pick({ title: true }).extend({
  dueLocal: z.string().min(1, 'יש לבחור מועד'),
  assigneeId: z.string().optional(),
});
type FormValues = z.infer<typeof formSchema>;

/** Quick add. With `leadId`, the task is linked to that lead. */
export function NewTaskForm({ leadId, compact }: { leadId?: string; compact?: boolean }) {
  const business = useCurrentBusiness();
  const canAssign = can(business.role, 'tasks.view.all');
  const members = useMembers(business.id, canAssign);
  const create = useCreateTask(business.id);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { title: '', dueLocal: defaultDueLocal(), assigneeId: '' },
  });

  const submit = form.handleSubmit(async (v) => {
    setFormError(null);
    try {
      await create.mutateAsync({
        title: v.title,
        dueAt: new Date(v.dueLocal).toISOString(),
        assigneeId: v.assigneeId || undefined,
        leadId: leadId ?? null,
      });
      form.reset({ title: '', dueLocal: defaultDueLocal(), assigneeId: v.assigneeId });
    } catch (err) {
      setFormError(applyServerErrors(err, form.setError, ['title']));
    }
  });

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-3" aria-label="משימה חדשה">
      {formError && <Alert tone="danger">{formError}</Alert>}
      <div
        className={
          compact
            ? 'flex flex-col gap-3'
            : 'grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end'
        }
      >
        <Field
          label="משימה חדשה"
          placeholder="למשל: להתקשר לגבי ההצעה"
          error={form.formState.errors.title?.message}
          {...form.register('title')}
        />
        <Field
          label="מועד"
          type="datetime-local"
          error={form.formState.errors.dueLocal?.message}
          {...form.register('dueLocal')}
        />
        {canAssign ? (
          <Select
            label="אחראי למשימה"
            options={[
              { value: '', label: 'אני' },
              ...(members.data ?? []).map((m) => ({ value: m.userId, label: m.fullName })),
            ]}
            {...form.register('assigneeId')}
          />
        ) : (
          !compact && <span />
        )}
        <Button type="submit" loading={form.formState.isSubmitting} className="self-end">
          <Plus aria-hidden className="h-4 w-4" />
          הוספה
        </Button>
      </div>
    </form>
  );
}
