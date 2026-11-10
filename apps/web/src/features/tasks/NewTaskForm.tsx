import { zodResolver } from '@hookform/resolvers/zod';
import { can, createTaskRequestSchema } from '@leadflow/shared';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Alert, Button, Field, Select } from '../../components/ui';
import { cn } from '../../lib/cn';
import { applyServerErrors } from '../auth/serverErrors';
import { useMembers } from '../businesses/api';
import { useCurrentBusiness } from '../shell/CurrentBusiness';
import { defaultDueLocal, useCreateTask } from './api';
import { LeadPicker, type PickedLead } from './LeadPicker';
import { tr } from '../../i18n';

/** Form values: due time as the `datetime-local` string; converted to ISO on submit. */
const formSchema = createTaskRequestSchema.pick({ title: true }).extend({
  dueLocal: z.string().min(1, tr('יש לבחור מועד')),
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
  // Only on the tasks page: on a lead's own page the task is already linked to it.
  const [picked, setPicked] = useState<PickedLead | null>(null);
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { title: '', dueLocal: defaultDueLocal(), assigneeId: '' },
  });

  // One row: what, when, (who), (which customer), add. The assignee is the narrow one.
  const columns = canAssign
    ? !leadId
      ? 'md:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,0.8fr)_minmax(0,1.5fr)_auto]'
      : 'md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]'
    : !leadId
      ? 'md:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,1.5fr)_auto]'
      : 'md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto]';

  const submit = form.handleSubmit(async (v) => {
    setFormError(null);
    try {
      await create.mutateAsync({
        title: v.title,
        dueAt: new Date(v.dueLocal).toISOString(),
        assigneeId: v.assigneeId || undefined,
        leadId: leadId ?? picked?.id ?? null,
      });
      setPicked(null);
      form.reset({ title: '', dueLocal: defaultDueLocal(), assigneeId: v.assigneeId });
    } catch (err) {
      setFormError(applyServerErrors(err, form.setError, ['title']));
    }
  });

  return (
    <form
      noValidate
      onSubmit={submit}
      className="flex flex-col gap-3"
      aria-label={tr('משימה חדשה')}
    >
      {formError && <Alert tone="danger">{formError}</Alert>}
      <div className={compact ? 'flex flex-col gap-3' : cn('grid gap-3 md:items-end', columns)}>
        <Field
          label={tr('משימה חדשה')}
          placeholder={tr('למשל: להתקשר לגבי ההצעה')}
          error={form.formState.errors.title?.message}
          {...form.register('title')}
        />
        <Field
          label={tr('מועד')}
          type="datetime-local"
          error={form.formState.errors.dueLocal?.message}
          {...form.register('dueLocal')}
        />
        {canAssign ? (
          <Select
            label={tr('אחראי למשימה')}
            options={[
              { value: '', label: tr('אני') },
              ...(members.data ?? []).map((m) => ({ value: m.userId, label: m.fullName })),
            ]}
            {...form.register('assigneeId')}
          />
        ) : null}
        {/* Same row as the rest; only on the tasks page (a lead's page already knows the lead). */}
        {!leadId && <LeadPicker value={picked} onChange={setPicked} floating />}
        <Button type="submit" loading={form.formState.isSubmitting} className="self-end">
          <Plus aria-hidden className="h-4 w-4" />
          {tr('הוספה')}
        </Button>
      </div>
    </form>
  );
}
