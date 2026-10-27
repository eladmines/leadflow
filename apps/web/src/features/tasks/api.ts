import {
  apiPaths,
  type CreateTaskRequest,
  type Task,
  type TaskListQuery,
  type TaskListResponse,
  type UpdateTaskRequest,
} from '@leadflow/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api';

const tp = apiPaths.tasks;
export const tasksQueryKey = (businessId: string) => ['businesses', businessId, 'tasks'] as const;

const qs = (q: TaskListQuery) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v) p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

export function useTasks(businessId: string, query: TaskListQuery = {}) {
  return useQuery({
    queryKey: [...tasksQueryKey(businessId), query],
    queryFn: () => apiFetch<TaskListResponse>(`${tp.list(businessId)}${qs(query)}`),
    select: (d) => d.tasks,
    refetchInterval: 60_000,
  });
}

/** Task changes also touch lead history, so lead detail caches are refreshed too. */
function useTaskMutation<T>(businessId: string, fn: (vars: T) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: tasksQueryKey(businessId) });
      void queryClient.invalidateQueries({
        queryKey: ['businesses', businessId, 'leads', 'detail'],
      });
    },
  });
}

export const useCreateTask = (businessId: string) =>
  useTaskMutation(businessId, (body: CreateTaskRequest) =>
    apiFetch<{ task: Task }>(tp.list(businessId), { method: 'POST', body: JSON.stringify(body) }),
  );

/** Optimistic for the common case (ticking a task done/undone). */
export function useUpdateTask(businessId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateTaskRequest }) =>
      apiFetch<{ task: Task }>(tp.task(businessId, id), {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onMutate: async ({ id, body }) => {
      if (!body.status) return undefined;
      const key = tasksQueryKey(businessId);
      await queryClient.cancelQueries({ queryKey: key });
      const snapshot = queryClient.getQueriesData<TaskListResponse>({ queryKey: key });
      queryClient.setQueriesData<TaskListResponse>({ queryKey: key }, (old) =>
        old
          ? { tasks: old.tasks.map((t) => (t.id === id ? { ...t, status: body.status! } : t)) }
          : old,
      );
      return { snapshot };
    },
    onError: (_e, _v, ctx) => {
      for (const [k, d] of ctx?.snapshot ?? []) queryClient.setQueryData(k, d);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: tasksQueryKey(businessId) });
      void queryClient.invalidateQueries({
        queryKey: ['businesses', businessId, 'leads', 'detail'],
      });
    },
  });
}

export const useDeleteTask = (businessId: string) =>
  useTaskMutation(businessId, (id: string) =>
    apiFetch(tp.task(businessId, id), { method: 'DELETE' }),
  );

/** `datetime-local` value for tomorrow 09:00 local time. */
export function defaultDueLocal(now = new Date()) {
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return toLocalInput(d.toISOString());
}

export const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

/** "היום 14:30", "מחר 09:00", or a short date. */
export function dueLabel(iso: string, now = new Date()) {
  const d = new Date(iso);
  const time = d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(d) - day(now)) / 86_400_000);
  if (diff === 0) return `היום ${time}`;
  if (diff === 1) return `מחר ${time}`;
  if (diff === -1) return `אתמול ${time}`;
  return `${d.toLocaleDateString('he-IL', { day: 'numeric', month: 'short' })} ${time}`;
}

/** Overdue / today / upcoming / done, using local days. */
export function groupTasks(tasks: Task[], now = new Date()) {
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
  const groups = {
    overdue: [] as Task[],
    today: [] as Task[],
    upcoming: [] as Task[],
    done: [] as Task[],
  };
  for (const t of tasks) {
    const due = new Date(t.dueAt).getTime();
    if (t.status === 'DONE') groups.done.push(t);
    else if (due < now.getTime()) groups.overdue.push(t);
    else if (due < endOfToday) groups.today.push(t);
    else groups.upcoming.push(t);
  }
  return groups;
}
