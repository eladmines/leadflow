import { can, type Task } from '@simplecatch/shared';
import { useState, type FormEvent } from 'react';
import { Alert, Button, DialogShell, Field, Select, Textarea } from '../../components/ui';
import { errorMessage } from '../auth/serverErrors';
import { useMembers } from '../businesses/api';
import { useCurrentBusiness } from '../shell/CurrentBusiness';
import { toLocalInput, useUpdateTask } from './api';
import { LeadPicker, type PickedLead } from './LeadPicker';
import { ApiError } from '../../lib/api';
import { SubjectPicker, subjectBody, type SubjectRef } from './subject';
import { tr } from '../../i18n';

/** Change a task: what to do, notes, when, who, which customer, and its quote or appointment (F35). */
export function EditTaskDialog({
  task,
  open,
  onOpenChange,
}: {
  task: Task;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const business = useCurrentBusiness();
  const canAssign = can(business.role, 'tasks.view.all');
  const members = useMembers(business.id, canAssign && open);
  const update = useUpdateTask(business.id);
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes ?? '');
  const [due, setDue] = useState(toLocalInput(task.dueAt));
  const [assigneeId, setAssigneeId] = useState(task.assignee.id);
  const [lead, setLead] = useState<PickedLead | null>(task.lead);
  const initialSubject: SubjectRef | null = task.subject
    ? { kind: task.subject.kind, id: task.subject.id }
    : null;
  const [subject, setSubject] = useState<SubjectRef | null>(initialSubject);
  const [subjectError, setSubjectError] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  // Sent only when changed: re-linking an automatic task makes it a person's task (D-213).
  const subjectChanged =
    subject?.kind !== initialSubject?.kind || subject?.id !== initialSubject?.id;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return setError(tr('יש לכתוב מה צריך לעשות'));
    if (!due) return setError(tr('יש לבחור מועד'));
    setError(null);
    setSubjectError(undefined);
    update.mutate(
      {
        id: task.id,
        body: {
          title: title.trim(),
          notes,
          dueAt: new Date(due).toISOString(),
          ...(canAssign ? { assigneeId } : {}),
          leadId: lead?.id ?? null,
          ...(subjectChanged ? subjectBody(subject) : {}),
        },
      },
      {
        onSuccess: () => onOpenChange(false),
        onError: (err) => {
          const f = err instanceof ApiError ? (err.fields ?? {}) : {};
          setSubjectError(f.quoteId ?? f.appointmentId ?? f.leadId);
        },
      },
    );
  };

  return (
    <DialogShell open={open} onOpenChange={onOpenChange} title={tr('עריכת משימה')}>
      <form noValidate onSubmit={submit} className="flex flex-col gap-4">
        <Field
          label={tr('מה צריך לעשות')}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <Textarea
          label={tr('הערות')}
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
        <Field
          label={tr('מועד')}
          type="datetime-local"
          value={due}
          onChange={(e) => setDue(e.target.value)}
        />
        {canAssign && (
          <Select
            label={tr('אחראי למשימה')}
            value={assigneeId}
            onChange={(e) => setAssigneeId(e.target.value)}
            options={(
              members.data ?? [{ userId: task.assignee.id, fullName: task.assignee.name }]
            ).map((m) => ({ value: m.userId, label: m.fullName }))}
          />
        )}
        <LeadPicker
          value={lead}
          onChange={(l) => {
            setLead(l);
            // A quote or appointment belongs to its lead: another lead drops the link.
            if (l?.id !== lead?.id) setSubject(null);
          }}
        />
        {lead && (
          <SubjectPicker
            leadId={lead.id}
            value={subject}
            onChange={(v) => {
              setSubject(v);
              setSubjectError(undefined);
            }}
            error={subjectError}
          />
        )}
        {(error || (update.isError && !subjectError)) && (
          <Alert tone="danger">{error ?? errorMessage(update.error)}</Alert>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            {tr('ביטול')}
          </Button>
          <Button type="submit" loading={update.isPending}>
            {tr('שמירה')}
          </Button>
        </div>
      </form>
    </DialogShell>
  );
}
