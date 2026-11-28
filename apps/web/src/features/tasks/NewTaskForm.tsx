import { zodResolver } from '@hookform/resolvers/zod';
import { can, createTaskRequestSchema } from '@simplecatch/shared';
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
import { ApiError } from '../../lib/api';
import { SubjectPicker, subjectBody, type SubjectRef } from './subject';
import { tr } from '../../i18n';

/** Form values: due time as the `datetime-local` string; converted to ISO on submit. */
// The request schema is refined (one subject at most, D-213); the title rule is its inner object's.
const formSchema = createTaskRequestSchema
  .innerType()
  .pick({ title: true })
  .extend({
    dueLocal: z.string().min(1, tr('יש לבחור מועד')),
    assigneeId: z.string().optional(),
  });
type FormValues = z.infer<typeof formSchema>;

/** The API's errors about the link (F35) land under the "קשור ל…" choice. */
const SUBJECT_FIELDS = ['quoteId', 'appointmentId', 'leadId'] as const;

/**
 * Quick add. With `leadId`, the task is linked to that lead. `autoFocus` puts the cursor in the
 * title (a form opened on demand); `onCreated` runs after a task was added.
 * F35: with a lead, the task may also be about one of its quotes or appointments ("קשור ל…");
 * `subject` fixes that link (the quote and appointment screens).
 */
export function NewTaskForm({
  leadId,
  subject: fixedSubject,
  compact,
  autoFocus,
  onCreated,
}: {
  leadId?: string;
  subject?: SubjectRef;
  compact?: boolean;
  autoFocus?: boolean;
  onCreated?: () => void;
}) {
  const business = useCurrentBusiness();
  const canAssign = can(business.role, 'tasks.view.all');
  const members = useMembers(business.id, canAssign);
  const create = useCreateTask(business.id);
  const [formError, setFormError] = useState<string | null>(null);
  // Only on the tasks page: on a lead's own page the task is already linked to it.
  const [picked, setPicked] = useState<PickedLead | null>(null);
  const [chosen, setChosen] = useState<SubjectRef | null>(null);
  const [subjectError, setSubjectError] = useState<string | undefined>();
  const taskLead = leadId ?? picked?.id ?? null;
  const subject = fixedSubject ?? chosen;
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

  const subjectPicker = !fixedSubject && taskLead && (
    <SubjectPicker
      leadId={taskLead}
      value={chosen}
      onChange={(v) => {
        setChosen(v);
        setSubjectError(undefined);
      }}
      error={subjectError}
    />
  );

  const submit = form.handleSubmit(async (v) => {
    setFormError(null);
    setSubjectError(undefined);
    try {
      await create.mutateAsync({
        title: v.title,
        dueAt: new Date(v.dueLocal).toISOString(),
        assigneeId: v.assigneeId || undefined,
        leadId: taskLead,
        ...subjectBody(subject),
      });
      setPicked(null);
      setChosen(null);
      form.reset({ title: '', dueLocal: defaultDueLocal(), assigneeId: v.assigneeId });
      onCreated?.();
    } catch (err) {
      const fields = err instanceof ApiError ? (err.fields ?? {}) : {};
      const onSubject = SUBJECT_FIELDS.map((f) => fields[f]).find(Boolean);
      if (onSubject) {
        setSubjectError(onSubject);
        // A fixed link has no picker to show it under.
        if (fixedSubject) setFormError(onSubject);
        return;
      }
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
          autoFocus={autoFocus}
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
        {!leadId && !fixedSubject && (
          <LeadPicker
            value={picked}
            onChange={(l) => {
              setPicked(l);
              // The link belongs to the lead it was chosen for.
              setChosen(null);
              setSubjectError(undefined);
            }}
            floating
          />
        )}
        {compact && subjectPicker}
        <Button type="submit" loading={form.formState.isSubmitting} className="self-end">
          <Plus aria-hidden className="h-4 w-4" />
          {tr('הוספה')}
        </Button>
      </div>
      {!compact && subjectPicker && <div className="md:max-w-sm">{subjectPicker}</div>}
    </form>
  );
}
