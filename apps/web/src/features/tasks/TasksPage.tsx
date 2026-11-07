import { can, type Task } from '@leadflow/shared';
import { ListTodo } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Alert, Card, EmptyState, Spinner } from '../../components/ui';
import { cn } from '../../lib/cn';
import { errorMessage } from '../auth/serverErrors';
import { useCurrentBusiness } from '../shell/CurrentBusiness';
import { PageHeader } from '../shell/PageHeader';
import { groupTasks, useTasks } from './api';
import { NewTaskForm } from './NewTaskForm';
import { TaskItem } from './TaskItem';
import { tr } from '../../i18n';

// Each group has its colour (D-139); the title says it too.
const sections: { key: keyof ReturnType<typeof groupTasks>; title: string; dot: string }[] = [
  { key: 'overdue', title: tr('באיחור'), dot: 'bg-rose-500' },
  { key: 'today', title: tr('היום'), dot: 'bg-amber-500' },
  { key: 'upcoming', title: tr('בהמשך'), dot: 'bg-sky-500' },
];

/** F10: follow-up tasks grouped by urgency. Managers can switch between "mine" and "everyone". */
export function TasksPage() {
  const business = useCurrentBusiness();
  const seesAll = can(business.role, 'tasks.view.all');
  const [params, setParams] = useSearchParams();
  const scope = seesAll && params.get('scope') === 'all' ? 'all' : 'mine';
  const tasks = useTasks(business.id, scope === 'mine' ? { assigneeId: 'me' } : {});
  const [showDone, setShowDone] = useState(false);
  const groups = groupTasks(tasks.data ?? []);
  const openCount = groups.overdue.length + groups.today.length + groups.upcoming.length;

  return (
    <>
      <PageHeader
        title={tr('משימות')}
        description={tr('מעקב אחרי מה שצריך לעשות ומתי. תזכורת נשלחת באימייל כשמגיע המועד.')}
        actions={
          seesAll && (
            <div
              role="group"
              aria-label={tr('של מי')}
              className="flex rounded-xl bg-surface-sunken p-1"
            >
              {(['mine', 'all'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={scope === s}
                  onClick={() => setParams(s === 'all' ? { scope: 'all' } : {}, { replace: true })}
                  className={cn(
                    'rounded-lg px-3 py-1.5 text-sm',
                    scope === s ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted',
                  )}
                >
                  {s === 'mine' ? tr('שלי') : tr('של כל הצוות')}
                </button>
              ))}
            </div>
          )
        }
      />
      <Card>
        <NewTaskForm />
      </Card>

      {tasks.isPending ? (
        <Spinner label={tr('טוענים משימות…')} />
      ) : tasks.isError ? (
        <Alert tone="danger">{errorMessage(tasks.error)}</Alert>
      ) : (
        <>
          {openCount === 0 && (
            <EmptyState
              icon={ListTodo}
              tone="bg-amber-500"
              title={tr('אין משימות פתוחות')}
              description={
                groups.done.length > 0
                  ? tr('כל המשימות בוצעו. כל הכבוד!')
                  : tr('הוסיפו משימה למעלה, או מתוך כרטיס של ליד — למשל "להתקשר מחר בבוקר".')
              }
            />
          )}
          {sections.map(({ key, title, dot }) =>
            groups[key].length > 0 ? (
              <Card key={key} className="py-3">
                <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
                  <span aria-hidden className={cn('h-2.5 w-2.5 rounded-full', dot)} />
                  {title}{' '}
                  <span className="text-sm font-normal text-ink-muted">({groups[key].length})</span>
                </h2>
                <ul aria-label={title} className="divide-y divide-surface-border">
                  {groups[key].map((t: Task) => (
                    <TaskItem
                      key={t.id}
                      task={t}
                      businessId={business.id}
                      showAssignee={scope === 'all'}
                    />
                  ))}
                </ul>
              </Card>
            ) : null,
          )}
          {groups.done.length > 0 && (
            <div className="flex flex-col gap-2">
              <button
                type="button"
                aria-expanded={showDone}
                onClick={() => setShowDone((v) => !v)}
                className="self-start text-sm font-medium text-brand-700 hover:underline"
              >
                {showDone ? tr('הסתרת') : tr('הצגת')} {tr('משימות שבוצעו (')}
                {groups.done.length})
              </button>
              {showDone && (
                <Card className="py-3">
                  <ul aria-label={tr('בוצעו')} className="divide-y divide-surface-border">
                    {groups.done.map((t) => (
                      <TaskItem
                        key={t.id}
                        task={t}
                        businessId={business.id}
                        showAssignee={scope === 'all'}
                      />
                    ))}
                  </ul>
                </Card>
              )}
            </div>
          )}
        </>
      )}
    </>
  );
}
