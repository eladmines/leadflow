import { z } from 'zod';
import { APPOINTMENT_STATUSES } from './appointments';
import { QUOTE_STATUSES } from './quotes';
import { addDays, dateInZone, weekdayOf, zonedTimeToUtc } from './time';

/**
 * F10 — Follow-up tasks (PRD §7, §19.6): title, assignee, due time, status, optional lead link,
 * and an email reminder to the assignee when the task is due.
 *
 * F35 (D-213): a task may also point at one quote **or** one appointment of the same business (its
 * "subject"), and the system creates and closes some follow-ups by itself (`autoKind`).
 */

export const TASK_STATUSES = ['OPEN', 'DONE'] as const;
export const taskStatusSchema = z.enum(TASK_STATUSES);

/**
 * D-213: kinds of task the system creates by itself. Only a task with an `autoKind` is ever
 * closed automatically; a person's task (`autoKind: null`) never is.
 * - `quote_followup`: "לחזור לגבי הצעה #N", created when a quote is sent, closed when it is
 *   accepted or rejected.
 * - `appointment_confirm`: "לאשר את הפגישה", created when an appointment is booked (for a customer's
 *   own booking, D-216, the D-152 notice task is this task), closed when it is cancelled, completed
 *   or marked no-show (D-214, D-216).
 */
export const TASK_AUTO_KINDS = ['quote_followup', 'appointment_confirm'] as const;
export const taskAutoKindSchema = z.enum(TASK_AUTO_KINDS);
export type TaskAutoKind = z.infer<typeof taskAutoKindSchema>;

export const taskMessages = {
  titleRequired: 'יש לכתוב מה צריך לעשות',
  titleTooLong: 'הכותרת ארוכה מדי (עד 200 תווים)',
  notesTooLong: 'ההערות ארוכות מדי (עד 1,000 תווים)',
  dueRequired: 'יש לבחור מועד',
  assigneeInvalid: 'אפשר להקצות רק לחבר צוות פעיל בעסק',
  leadInvalid: 'הליד שנבחר אינו קיים',
  /** F35 (D-213). */
  quoteInvalid: 'ההצעה שנבחרה אינה קיימת',
  appointmentInvalid: 'הפגישה שנבחרה אינה קיימת',
  subjectBoth: 'אפשר לקשר משימה להצעה או לפגישה, לא לשניהם',
  subjectOtherLead: 'ההצעה או הפגישה שייכות לליד אחר. בטלו את הקישור או בחרו את הליד שלהם.',
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

/** A request may link a quote or an appointment, never both at once (D-213). */
const oneSubject = (v: { quoteId?: string | null; appointmentId?: string | null }) =>
  !(v.quoteId && v.appointmentId);
const oneSubjectError = { message: taskMessages.subjectBoth, path: ['appointmentId'] };

/**
 * POST /tasks. F35: `quoteId` / `appointmentId` (at most one) must be a quote / appointment of this
 * business that the member may see. With a subject, the task's lead is the subject's lead: an omitted
 * or null `leadId` takes it, a different `leadId` is refused (`subjectOtherLead`).
 */
export const createTaskRequestSchema = z
  .object({
    title,
    notes,
    dueAt,
    /** Defaults to the creator. Employees can only assign to themselves. */
    assigneeId: z.string().uuid().optional(),
    leadId: z.string().uuid().nullable().optional(),
    quoteId: z.string().uuid().nullable().optional(),
    appointmentId: z.string().uuid().nullable().optional(),
    remind: z.boolean().default(true),
  })
  .refine(oneSubject, oneSubjectError);
export type CreateTaskRequest = z.input<typeof createTaskRequestSchema>;

/**
 * PATCH /tasks/:id. F35: `quoteId` / `appointmentId` set (uuid) or remove (null) the subject; setting
 * one replaces the other (the stored task never has both). Changing the subject of an automatic
 * task makes it a person's task (`autoKind` → null). A `leadId` that differs from the subject's lead
 * is refused unless the same request also unlinks the subject.
 */
export const updateTaskRequestSchema = z
  .object({
    title: title.optional(),
    notes: notes.optional(),
    dueAt: dueAt.optional(),
    assigneeId: z.string().uuid().optional(),
    /** Link to a lead, or null to unlink. */
    leadId: z.string().uuid().nullable().optional(),
    quoteId: z.string().uuid().nullable().optional(),
    appointmentId: z.string().uuid().nullable().optional(),
    status: taskStatusSchema.optional(),
    remind: z.boolean().optional(),
  })
  .refine(oneSubject, oneSubjectError);
export type UpdateTaskRequest = z.input<typeof updateTaskRequestSchema>;

/**
 * GET /tasks filters. `due=overdue` = open and past due. F35: `quoteId` / `appointmentId` = the tasks
 * on that quote / appointment (still only those the member may see: employees, their own).
 */
export const taskListQuerySchema = z.object({
  status: taskStatusSchema.optional(),
  assigneeId: z.union([z.literal('me'), z.string().uuid()]).optional(),
  leadId: z.string().uuid().optional(),
  quoteId: z.string().uuid().optional(),
  appointmentId: z.string().uuid().optional(),
  due: z.enum(['overdue']).optional(),
});
export type TaskListQuery = z.input<typeof taskListQuerySchema>;

/**
 * F35: what a task is about, for display ("על הצעה #12" / "על הפגישה ב-…"). The web formats the label:
 * the quote's number, or the appointment's start in the business's time zone. Shown even when the
 * member can't open the quote/appointment itself (the link then 404s like any hidden record).
 */
export const taskSubjectSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('quote'),
    id: z.string().uuid(),
    number: z.number().int(),
    status: z.enum(QUOTE_STATUSES),
  }),
  z.object({
    kind: z.literal('appointment'),
    id: z.string().uuid(),
    startsAt: z.string().datetime(),
    status: z.enum(APPOINTMENT_STATUSES),
  }),
]);
export type TaskSubject = z.infer<typeof taskSubjectSchema>;

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
  /**
   * F35: the linked quote or appointment, or null. The API always sends it; optional only so older
   * payloads and fixtures still parse.
   */
  subject: taskSubjectSchema.nullable().optional(),
  /** F35: set on tasks the system created (D-213); null = a person's task. Always sent, see above. */
  autoKind: taskAutoKindSchema.nullable().optional(),
  createdAt: z.string().datetime(),
});
export type Task = z.infer<typeof taskSchema>;

export const taskResponseSchema = z.object({ task: taskSchema });
export const taskListResponseSchema = z.object({ tasks: z.array(taskSchema) });
export type TaskListResponse = z.infer<typeof taskListResponseSchema>;

// ---------------------------------------------------------------------------
// F35 — automatic follow-ups (D-213): per-business switches and timing
// ---------------------------------------------------------------------------

/**
 * GET/PUT /automations/tasks. Both default on, existing businesses included (D-216). Switching one off
 * stops new tasks of that kind; tasks already created stay, and still close themselves.
 */
export const taskAutomationsSchema = z.object({
  /** Quote sent → "לחזור לגבי הצעה #N". */
  quoteFollowUp: z.boolean(),
  /** Appointment booked → "לאשר את הפגישה". */
  appointmentConfirm: z.boolean(),
});
export type TaskAutomations = z.infer<typeof taskAutomationsSchema>;
export const updateTaskAutomationsRequestSchema = taskAutomationsSchema;
export type UpdateTaskAutomationsRequest = z.input<typeof updateTaskAutomationsRequestSchema>;
export const taskAutomationsResponseSchema = z.object({ settings: taskAutomationsSchema });
export type TaskAutomationsResponse = z.infer<typeof taskAutomationsResponseSchema>;

/** Wall-clock time (business time zone) of automatic follow-ups (D-214). */
export const AUTO_TASK_TIME = '09:00';
/** Days after a quote is sent that its follow-up is due (D-213). */
export const QUOTE_FOLLOW_UP_DAYS = 2;

/** D-216 (1): Friday and Saturday are not work days for automatic tasks. */
const isWeekend = (date: string) => {
  const day = weekdayOf(date);
  return day === 5 || day === 6;
};
/** The Sunday after a Friday / Saturday `YYYY-MM-DD`. */
const sundayAfter = (date: string) => addDays(date, 7 - weekdayOf(date));
/** The Thursday before a Friday / Saturday `YYYY-MM-DD`. */
const thursdayBefore = (date: string) => addDays(date, 4 - weekdayOf(date));

/**
 * D-214 + D-216: a quote follow-up is due at 09:00 (business time zone) on the second calendar day
 * after the day the quote was sent there; when that day is a Friday or Saturday it moves to the
 * following **Sunday 09:00**. Sent Sunday 18:30 → Tuesday 09:00; sent Wednesday → Friday → Sunday;
 * sent Thursday → Saturday → Sunday. Re-sending recomputes it from the new send time.
 */
export function quoteFollowUpDueAt(sentAt: Date, timeZone: string): Date {
  let day = addDays(dateInZone(sentAt, timeZone), QUOTE_FOLLOW_UP_DAYS);
  if (isWeekend(day)) day = sundayAfter(day);
  return zonedTimeToUtc(day, AUTO_TASK_TIME, timeZone);
}

/**
 * D-214 + D-216: an appointment's confirm task, in the business time zone.
 * 1. An appointment whose date is today or earlier gets no task at booking time: `null`.
 * 2. Otherwise the candidate is 09:00 on the day before the appointment.
 * 3. If that day is a Friday or Saturday, the candidate moves to the following Sunday 09:00, but
 *    only if that is still **before the appointment starts**; otherwise (a Saturday appointment, or
 *    a Sunday one starting at or before 09:00) it moves back to the preceding **Thursday 09:00**.
 * 4. If the candidate is not after `now`, the task is due `now`.
 * On reschedule an existing open task is moved to `appointmentConfirmDueAt(newStart, now, tz) ?? now`
 * (a move never creates or closes it).
 */
export function appointmentConfirmDueAt(startsAt: Date, now: Date, timeZone: string): Date | null {
  const startDay = dateInZone(startsAt, timeZone);
  if (startDay <= dateInZone(now, timeZone)) return null;
  const dayBefore = addDays(startDay, -1);
  let due = zonedTimeToUtc(dayBefore, AUTO_TASK_TIME, timeZone);
  if (isWeekend(dayBefore)) {
    const sunday = zonedTimeToUtc(sundayAfter(dayBefore), AUTO_TASK_TIME, timeZone);
    due =
      sunday.getTime() < startsAt.getTime()
        ? sunday
        : zonedTimeToUtc(thursdayBefore(dayBefore), AUTO_TASK_TIME, timeZone);
  }
  return due.getTime() > now.getTime() ? due : now;
}

/**
 * Titles of automatic tasks, in the business's language (D-142: like the other system tasks,
 * D-152). Stored on the task, so a person can rename it. D-216 (2): a customer's own booking (the
 * D-152 notice) becomes the confirm task, titled with its details:
 * `appointment_confirm('דנה · תספורת · יום ב׳ 2.12 10:00')` → "לאשר את הפגישה: דנה · תספורת · …".
 */
export const autoTaskTitles = {
  he: {
    quote_followup: (number: number) => `לחזור לגבי הצעה #${number}`,
    appointment_confirm: (details?: string) =>
      details ? `לאשר את הפגישה: ${details}` : 'לאשר את הפגישה',
  },
  en: {
    quote_followup: (number: number) => `Follow up on quote #${number}`,
    appointment_confirm: (details?: string) =>
      details ? `Confirm the appointment: ${details}` : 'Confirm the appointment',
  },
} as const;

export const tasksApiPaths = {
  list: (businessId: string) => `/api/v1/businesses/${businessId}/tasks`,
  task: (businessId: string, taskId: string) => `/api/v1/businesses/${businessId}/tasks/${taskId}`,
  /** F35: GET (`tasks.view`) / PUT (`automations.manage`) the automatic follow-up switches. */
  automations: (businessId: string) => `/api/v1/businesses/${businessId}/automations/tasks`,
} as const;

/** Is an open task past due at `now`? */
export const isOverdue = (t: Pick<Task, 'status' | 'dueAt'>, now = Date.now()) =>
  t.status === 'OPEN' && new Date(t.dueAt).getTime() < now;
