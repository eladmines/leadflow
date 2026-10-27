import { z } from 'zod';

/**
 * F10 — Follow-up tasks (PRD §7, §19.6): title, assignee, due time, status, optional lead link,
 * and an email reminder to the assignee when the task is due.
 */

export const TASK_STATUSES = ['OPEN', 'DONE'] as const;
export const taskStatusSchema = z.enum(TASK_STATUSES);

export const taskMessages = {
  titleRequired: 'יש לכתוב מה צריך לעשות',
  titleTooLong: 'הכותרת ארוכה מדי (עד 200 תווים)',
  notesTooLong: 'ההערות ארוכות מדי (עד 1,000 תווים)',
  dueRequired: 'יש לבחור מועד',
  assigneeInvalid: 'אפשר להקצות רק לחבר צוות פעיל בעסק',
  leadInvalid: 'הליד שנבחר אינו קיים',
} as const;

const title = z
  .string({ required_error: taskMessages.titleRequired })
  .trim()
  .min(1, taskMessages.titleRequired)
  .max(200, taskMessages.titleTooLong);
const notes = z
  .string()
  .trim()
  .max(1000, taskMessages.notesTooLong)
  .optional()
  .transform((v) => (v ? v : null));
const dueAt = z
  .string({ required_error: taskMessages.dueRequired })
  .datetime({ message: taskMessages.dueRequired });

export const createTaskRequestSchema = z.object({
  title,
  notes,
  dueAt,
  /** Defaults to the creator. Employees can only assign to themselves. */
  assigneeId: z.string().uuid().optional(),
  leadId: z.string().uuid().nullable().optional(),
  remind: z.boolean().default(true),
});
export type CreateTaskRequest = z.input<typeof createTaskRequestSchema>;

export const updateTaskRequestSchema = z.object({
  title: title.optional(),
  notes: notes.optional(),
  dueAt: dueAt.optional(),
  assigneeId: z.string().uuid().optional(),
  status: taskStatusSchema.optional(),
  remind: z.boolean().optional(),
});
export type UpdateTaskRequest = z.input<typeof updateTaskRequestSchema>;

/** GET /tasks filters. `due=overdue` = open and past due. */
export const taskListQuerySchema = z.object({
  status: taskStatusSchema.optional(),
  assigneeId: z.union([z.literal('me'), z.string().uuid()]).optional(),
  leadId: z.string().uuid().optional(),
  due: z.enum(['overdue']).optional(),
});
export type TaskListQuery = z.input<typeof taskListQuerySchema>;

export const taskSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  notes: z.string().nullable(),
  dueAt: z.string().datetime(),
  status: taskStatusSchema,
  remind: z.boolean(),
  completedAt: z.string().datetime().nullable(),
  assignee: z.object({ id: z.string().uuid(), name: z.string() }),
  lead: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
  createdAt: z.string().datetime(),
});
export type Task = z.infer<typeof taskSchema>;

export const taskResponseSchema = z.object({ task: taskSchema });
export const taskListResponseSchema = z.object({ tasks: z.array(taskSchema) });
export type TaskListResponse = z.infer<typeof taskListResponseSchema>;

export const tasksApiPaths = {
  list: (businessId: string) => `/api/v1/businesses/${businessId}/tasks`,
  task: (businessId: string, taskId: string) => `/api/v1/businesses/${businessId}/tasks/${taskId}`,
} as const;

/** Is an open task past due at `now`? */
export const isOverdue = (t: Pick<Task, 'status' | 'dueAt'>, now = Date.now()) =>
  t.status === 'OPEN' && new Date(t.dueAt).getTime() < now;
