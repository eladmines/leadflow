import { can, type Task } from '@leadflow/shared';
import { useState, type FormEvent } from 'react';
import { Alert, Button, DialogShell, Field, Select, Textarea } from '../../components/ui';
import { errorMessage } from '../auth/serverErrors';
import { useMembers } from '../businesses/api';
import { useCurrentBusiness } from '../shell/CurrentBusiness';
import { toLocalInput, useUpdateTask } from './api';
import { LeadPicker, type PickedLead } from './LeadPicker';
import { tr } from '../../i18n';

/** Change a task: what to do, notes, when, who, and which customer it is about. */
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
  const [error, setError] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return setError(tr('יש לכתוב מה צריך לעשות'));
    if (!due) return setError(tr('יש לבחור מועד'));
    setError(null);
    update.mutate(
      {
        id: task.id,
        body: {
          title: title.trim(),
          notes,
          dueAt: new Date(due).toISOString(),
          ...(canAssign ? { assigneeId } : {}),
          leadId: lead?.id ?? null,
        },
      },
      { onSuccess: () => onOpenChange(false) },
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
        <LeadPicker value={lead} onChange={setLead} />
        {(error || update.isError) && (
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
