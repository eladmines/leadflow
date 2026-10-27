import type { FastifyBaseLogger } from 'fastify';
import type { Prisma, PrismaClient } from '@prisma/client';
import {
  can,
  taskMessages,
  type createTaskRequestSchema,
  type Task,
  type taskListQuerySchema,
  type updateTaskRequestSchema,
} from '@leadflow/shared';
import type { z } from 'zod';
import type { AppConfig } from '../../config/env';
import { taskReminderTemplate, type EmailSender } from '../../integrations/email';
import type { Db } from '../../lib/db';
import { AppError } from '../../lib/errors';
import type { TenantContext } from '../../plugins/tenant';

const include = {
  assignee: { select: { id: true, fullName: true } },
  lead: { select: { id: true, contact: { select: { name: true } } } },
} as const;
type Row = Prisma.TaskGetPayload<{ include: typeof include }>;

const toDto = (r: Row): Task => ({
  id: r.id,
  title: r.title,
  notes: r.notes,
  dueAt: r.dueAt.toISOString(),
  status: r.status,
  remind: r.remind,
  completedAt: r.completedAt?.toISOString() ?? null,
  assignee: { id: r.assignee.id, name: r.assignee.fullName },
  lead: r.lead ? { id: r.lead.id, name: r.lead.contact.name } : null,
  createdAt: r.createdAt.toISOString(),
});

type ListQuery = z.output<typeof taskListQuerySchema>;
type CreateInput = z.output<typeof createTaskRequestSchema>;
type UpdateInput = z.output<typeof updateTaskRequestSchema>;

/** Reminders older than this are skipped (e.g. after downtime) instead of arriving late. */
const REMINDER_WINDOW_MS = 24 * 60 * 60 * 1000;

export class TaskService {
  constructor(private readonly prisma: PrismaClient) {}

  /** Owner/manager: all tasks; employee: tasks assigned to them. */
  private visible(ctx: TenantContext): Prisma.TaskWhereInput {
    return {
      businessId: ctx.businessId,
      ...(can(ctx.role, 'tasks.view.all') ? {} : { assigneeId: ctx.userId }),
    };
  }

  private async findVisible(ctx: TenantContext, taskId: string, db: Db = this.prisma) {
    const task = /^[0-9a-f-]{36}$/i.test(taskId)
      ? await db.task.findFirst({ where: { id: taskId, ...this.visible(ctx) }, include })
      : null;
    if (!task) throw new AppError('NOT_FOUND');
    return task;
  }

  private async requireAssignee(db: Db, ctx: TenantContext, userId: string) {
    if (userId !== ctx.userId && !can(ctx.role, 'tasks.view.all')) throw new AppError('FORBIDDEN');
    const m = await db.membership.findFirst({
      where: { businessId: ctx.businessId, userId, status: 'ACTIVE' },
    });
    if (!m)
      throw new AppError('VALIDATION_ERROR', taskMessages.assigneeInvalid, {
        assigneeId: taskMessages.assigneeInvalid,
      });
  }

  /** A task may only link to a lead the member can see (employees: their own leads). */
  private async requireLead(db: Db, ctx: TenantContext, leadId: string) {
    const lead = await db.lead.findFirst({
      where: {
        id: leadId,
        businessId: ctx.businessId,
        ...(can(ctx.role, 'leads.view.all') ? {} : { ownerId: ctx.userId }),
      },
      select: { id: true },
    });
    if (!lead)
      throw new AppError('VALIDATION_ERROR', taskMessages.leadInvalid, {
        leadId: taskMessages.leadInvalid,
      });
  }

  async list(ctx: TenantContext, q: ListQuery = {}): Promise<Task[]> {
    const rows = await this.prisma.task.findMany({
      where: {
        AND: [
          this.visible(ctx),
          ...(q.status ? [{ status: q.status }] : []),
          ...(q.assigneeId
            ? [{ assigneeId: q.assigneeId === 'me' ? ctx.userId : q.assigneeId }]
            : []),
          ...(q.leadId ? [{ leadId: q.leadId }] : []),
          ...(q.due === 'overdue' ? [{ status: 'OPEN' as const, dueAt: { lt: new Date() } }] : []),
        ],
      },
      include,
      orderBy: [{ status: 'asc' }, { dueAt: 'asc' }],
      take: 500,
    });
    return rows.map(toDto);
  }

  async create(ctx: TenantContext, input: CreateInput): Promise<Task> {
    const assigneeId = input.assigneeId ?? ctx.userId;
    const row = await this.prisma.$transaction(async (tx) => {
      await this.requireAssignee(tx, ctx, assigneeId);
      if (input.leadId) await this.requireLead(tx, ctx, input.leadId);
      const task = await tx.task.create({
        data: {
          businessId: ctx.businessId,
          title: input.title,
          notes: input.notes,
          dueAt: new Date(input.dueAt),
          assigneeId,
          leadId: input.leadId ?? null,
          remind: input.remind,
          createdById: ctx.userId,
        },
        include,
      });
      if (task.leadId) {
        await tx.activity.create({
          data: {
            businessId: ctx.businessId,
            leadId: task.leadId,
            actorId: ctx.userId,
            type: 'task.created',
            data: {
              title: task.title,
              dueAt: task.dueAt.toISOString(),
              assignee: task.assignee.fullName,
            },
          },
        });
      }
      return task;
    });
    return toDto(row);
  }

  async update(ctx: TenantContext, taskId: string, input: UpdateInput): Promise<Task> {
    const row = await this.prisma.$transaction(async (tx) => {
      const task = await this.findVisible(ctx, taskId, tx);
      const data: Prisma.TaskUncheckedUpdateInput = {};
      if (input.title !== undefined) data.title = input.title;
      if (input.notes !== undefined) data.notes = input.notes;
      if (input.remind !== undefined) data.remind = input.remind;
      if (input.dueAt !== undefined && new Date(input.dueAt).getTime() !== task.dueAt.getTime()) {
        data.dueAt = new Date(input.dueAt);
        data.reminderSentAt = null; // a new due time gets a new reminder
      }
      if (input.assigneeId !== undefined && input.assigneeId !== task.assigneeId) {
        await this.requireAssignee(tx, ctx, input.assigneeId);
        data.assigneeId = input.assigneeId;
      }
      const completing = input.status === 'DONE' && task.status !== 'DONE';
      if (input.status !== undefined && input.status !== task.status) {
        data.status = input.status;
        data.completedAt = input.status === 'DONE' ? new Date() : null;
      }
      const updated = await tx.task.update({ where: { id: task.id }, data, include });
      if (completing && task.leadId) {
        await tx.activity.create({
          data: {
            businessId: ctx.businessId,
            leadId: task.leadId,
            actorId: ctx.userId,
            type: 'task.completed',
            data: { title: updated.title },
          },
        });
      }
      return updated;
    });
    return toDto(row);
  }

  async remove(ctx: TenantContext, taskId: string) {
    const task = await this.findVisible(ctx, taskId);
    await this.prisma.task.delete({ where: { id: task.id } });
  }

  /**
   * Emails assignees of open tasks that are due. Each reminder is claimed with a conditional
   * update first, so it's sent once even if several workers run. Returns how many were sent.
   */
  async sendDueReminders(
    email: EmailSender,
    config: AppConfig,
    log: Pick<FastifyBaseLogger, 'error'>,
    now = new Date(),
  ): Promise<number> {
    const due = await this.prisma.task.findMany({
      where: {
        status: 'OPEN',
        remind: true,
        reminderSentAt: null,
        dueAt: { lte: now, gt: new Date(now.getTime() - REMINDER_WINDOW_MS) },
      },
      include: {
        ...include,
        assignee: { select: { id: true, fullName: true, email: true, status: true } },
        business: { select: { timezone: true } },
      },
      take: 100,
    });
    let sent = 0;
    for (const t of due) {
      const claimed = await this.prisma.task.updateMany({
        where: { id: t.id, reminderSentAt: null, status: 'OPEN' },
        data: { reminderSentAt: now },
      });
      if (claimed.count === 0 || t.assignee.status !== 'ACTIVE') continue;
      const member = await this.prisma.membership.findFirst({
        where: { businessId: t.businessId, userId: t.assigneeId, status: 'ACTIVE' },
      });
      if (!member) continue;
      const dueText = new Intl.DateTimeFormat('he-IL', {
        dateStyle: 'full',
        timeStyle: 'short',
        timeZone: t.business.timezone,
      }).format(t.dueAt);
      const link = t.leadId
        ? `${config.APP_URL}/b/${t.businessId}/leads/${t.leadId}`
        : `${config.APP_URL}/b/${t.businessId}/tasks`;
      try {
        await email.send({
          to: t.assignee.email,
          ...taskReminderTemplate({
            name: t.assignee.fullName,
            title: t.title,
            dueText,
            leadName: t.lead?.contact.name ?? null,
            link,
          }),
        });
        sent += 1;
      } catch (err) {
        log.error(
          { errName: (err as Error)?.name, template: 'taskReminder' },
          'task reminder email failed',
        );
      }
    }
    return sent;
  }
}
