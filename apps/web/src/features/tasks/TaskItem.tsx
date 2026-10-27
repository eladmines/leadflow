import { businessWebPaths, isOverdue, type Task } from '@leadflow/shared';
import { AlarmClock, Trash2, UserRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '../../lib/cn';
import { dueLabel, useDeleteTask, useUpdateTask } from './api';

/** One task row: tick to complete, due time (red when overdue), lead link, assignee, delete. */
export function TaskItem({
  task,
  businessId,
  showLead = true,
  showAssignee = true,
}: {
  task: Task;
  businessId: string;
  showLead?: boolean;
  showAssignee?: boolean;
}) {
  const update = useUpdateTask(businessId);
  const remove = useDeleteTask(businessId);
  const done = task.status === 'DONE';
  const late = isOverdue(task);

  return (
    <li className="group flex items-start gap-3 py-3">
      <input
        type="checkbox"
        checked={done}
        onChange={() => update.mutate({ id: task.id, body: { status: done ? 'OPEN' : 'DONE' } })}
        aria-label={`${done ? 'החזרה לפתוחה' : 'סימון כבוצעה'}: ${task.title}`}
        className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer rounded accent-brand-600"
      />
      <div className="min-w-0 flex-1">
        <p
          className={cn('text-sm font-medium', done ? 'text-ink-subtle line-through' : 'text-ink')}
        >
          {task.title}
        </p>
        {task.notes && <p className="text-xs text-ink-muted">{task.notes}</p>}
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
          <span
            className={cn('inline-flex items-center gap-1', late && 'font-medium text-danger-600')}
          >
            <AlarmClock aria-hidden className="h-3.5 w-3.5" />
            <time dateTime={task.dueAt}>{dueLabel(task.dueAt)}</time>
            {late && <span>· באיחור</span>}
          </span>
          {showLead && task.lead && (
            <Link
              to={`${businessWebPaths.section(businessId, 'leads')}/${task.lead.id}`}
              className="text-brand-700 hover:underline"
            >
              {task.lead.name}
            </Link>
          )}
          {showAssignee && (
            <span className="inline-flex items-center gap-1">
              <UserRound aria-hidden className="h-3.5 w-3.5" />
              {task.assignee.name}
            </span>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={() => remove.mutate(task.id)}
        aria-label={`מחיקת המשימה: ${task.title}`}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-subtle opacity-0 hover:bg-surface-sunken hover:text-danger-600 focus:opacity-100 group-hover:opacity-100"
      >
        <Trash2 aria-hidden className="h-4 w-4" />
      </button>
    </li>
  );
}
