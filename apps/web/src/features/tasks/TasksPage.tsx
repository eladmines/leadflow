import { can, type Task } from '@leadflow/shared';
import { ListTodo } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Alert, Card, Spinner } from '../../components/ui';
import { cn } from '../../lib/cn';
import { errorMessage } from '../auth/serverErrors';
import { useCurrentBusiness } from '../shell/CurrentBusiness';
import { PageHeader } from '../shell/PageHeader';
import { groupTasks, useTasks } from './api';
import { NewTaskForm } from './NewTaskForm';
import { TaskItem } from './TaskItem';

const sections: { key: keyof ReturnType<typeof groupTasks>; title: string; tone?: string }[] = [
  { key: 'overdue', title: 'באיחור', tone: 'text-danger-600' },
  { key: 'today', title: 'היום' },
  { key: 'upcoming', title: 'בהמשך' },
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
        title="משימות"
        description="מעקב אחרי מה שצריך לעשות ומתי. תזכורת נשלחת באימייל כשמגיע המועד."
        actions={
          seesAll && (
            <div role="group" aria-label="של מי" className="flex rounded-xl bg-surface-sunken p-1">
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
                  {s === 'mine' ? 'שלי' : 'של כל הצוות'}
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
        <Spinner label="טוענים משימות…" />
      ) : tasks.isError ? (
        <Alert tone="danger">{errorMessage(tasks.error)}</Alert>
      ) : (
        <>
          {openCount === 0 && (
            <section className="flex flex-col items-center gap-3 rounded-3xl border border-surface-border bg-surface px-6 py-14 text-center shadow-card">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
                <ListTodo aria-hidden className="h-7 w-7" />
              </span>
              <h2 className="text-lg font-semibold text-ink">אין משימות פתוחות</h2>
              <p className="max-w-md text-sm text-ink-muted">
                {groups.done.length > 0
                  ? 'כל המשימות בוצעו. כל הכבוד!'
                  : 'הוסיפו משימה למעלה, או מתוך כרטיס של ליד — למשל "להתקשר מחר בבוקר".'}
              </p>
            </section>
          )}
          {sections.map(({ key, title, tone }) =>
            groups[key].length > 0 ? (
              <Card key={key} className="py-3">
                <h2 className={cn('text-base font-semibold', tone ?? 'text-ink')}>
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
                {showDone ? 'הסתרת' : 'הצגת'} משימות שבוצעו ({groups.done.length})
              </button>
              {showDone && (
                <Card className="py-3">
                  <ul aria-label="בוצעו" className="divide-y divide-surface-border">
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
