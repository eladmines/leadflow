import { useRef, useState } from 'react';
import { Alert, Button, Spinner } from '../../components/ui';
import { ApiError } from '../../lib/api';
import { tr } from '../../i18n';
import { errorMessage } from '../auth/serverErrors';
import { useCurrentBusiness } from '../shell/CurrentBusiness';
import { useTasks } from './api';
import { NewTaskForm } from './NewTaskForm';
import type { SubjectRef } from './subject';
import { TaskItem } from './TaskItem';

/**
 * F35: the tasks about one quote or appointment (`GET /tasks?quoteId=` / `?appointmentId=`; employees
 * see only their own), open ones first, and "+ משימה" already linked to it.
 */
export function LinkedTasks({
  subject,
  leadId,
  headingLevel = 2,
}: {
  subject: SubjectRef;
  /** The subject's lead, when it has one (the new task goes on it). */
  leadId?: string | null;
  headingLevel?: 2 | 3;
}) {
  const business = useCurrentBusiness();
  const tasks = useTasks(
    business.id,
    subject.kind === 'quote' ? { quoteId: subject.id } : { appointmentId: subject.id },
  );
  const [adding, setAdding] = useState(false);
  const addRef = useRef<HTMLButtonElement>(null);
  const id = `linked-tasks-${subject.id}`;
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  const list = [...(tasks.data ?? [])].sort(
    (a, b) =>
      (a.status === 'OPEN' ? 0 : 1) - (b.status === 'OPEN' ? 0 : 1) ||
      new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime(),
  );
  const close = () => {
    setAdding(false);
    addRef.current?.focus();
  };

  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Heading id={`${id}-title`} className="text-base font-semibold text-ink">
          {tr('משימות')}
        </Heading>
        <Button
          ref={addRef}
          type="button"
          size="sm"
          variant="secondary"
          aria-expanded={adding}
          aria-controls={adding ? `${id}-form` : undefined}
          onClick={() => (adding ? close() : setAdding(true))}
        >
          {tr('+ משימה')}
        </Button>
      </div>
      {adding && (
        <div id={`${id}-form`} className="flex flex-col gap-2 rounded-xl bg-surface-muted p-3">
          <NewTaskForm
            leadId={leadId ?? undefined}
            subject={subject}
            compact
            autoFocus
            onCreated={close}
          />
          <Button type="button" variant="ghost" size="sm" className="self-start" onClick={close}>
            {tr('ביטול')}
          </Button>
        </div>
      )}
      {tasks.isPending ? (
        <Spinner size="sm" label={tr('טוענים את המשימות…')} />
      ) : tasks.isError ? (
        tasks.error instanceof ApiError && tasks.error.status === 403 ? (
          <p className="text-sm text-ink-muted">{tr('אין לך הרשאה לראות את המשימות האלה.')}</p>
        ) : (
          <div className="flex flex-col gap-2">
            <Alert tone="danger">{errorMessage(tasks.error)}</Alert>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="self-start"
              onClick={() => void tasks.refetch()}
            >
              {tr('נסו שוב')}
            </Button>
          </div>
        )
      ) : list.length > 0 ? (
        <ul
          aria-label={subject.kind === 'quote' ? tr('משימות על ההצעה') : tr('משימות על התור')}
          className="divide-y divide-surface-border"
        >
          {list.map((t) => (
            <TaskItem key={t.id} task={t} businessId={business.id} showSubject={false} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-ink-muted">
          {subject.kind === 'quote'
            ? tr('אין משימות על ההצעה הזו.')
            : tr('אין משימות על התור הזה.')}
        </p>
      )}
    </section>
  );
}
