import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { apiPaths } from '@leadflow/shared';
import { createTestApp, resetDb } from '../../../test/helpers';
import { addMember, newUser, ownerWithBusiness, req } from '../../../test/business-helpers';
import { TaskService } from './service';

const tp = apiPaths.tasks;
const lp = apiPaths.leads;
const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

describe('tasks (F10)', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    ctx.email.clear();
  });

  async function team() {
    const owner = await ownerWithBusiness(ctx.app, 'owner');
    const id = owner.business.id;
    const emp = await newUser(ctx.app, 'emp');
    await addMember(ctx.prisma, id, emp.userId, 'EMPLOYEE');
    ctx.email.clear();
    return { owner, emp, id };
  }
  const create = (id: string, token: string, body: object) =>
    req(ctx.app, 'POST', tp.list(id), token, body);
  const lead = async (id: string, token: string, extra: object = {}) =>
    (
      await req(ctx.app, 'POST', lp.list(id), token, {
        name: 'רון לוי',
        phone: '052-1112233',
        ...extra,
      })
    ).json().lead;

  it('creates a task (assigned to the creator by default) and lists open tasks by due time', async () => {
    const t = await team();
    const later = await create(t.id, t.owner.token, {
      title: 'לשלוח הצעת מחיר',
      dueAt: inHours(48),
    });
    expect(later.statusCode).toBe(201);
    expect(later.json().task).toMatchObject({
      title: 'לשלוח הצעת מחיר',
      status: 'OPEN',
      remind: true,
      assignee: { id: t.owner.userId },
      lead: null,
    });
    await create(t.id, t.owner.token, { title: 'להתקשר', dueAt: inHours(2) });
    const bad = await create(t.id, t.owner.token, { title: ' ', dueAt: 'tomorrow' });
    expect(bad.statusCode).toBe(400);
    expect(Object.keys(bad.json().error.fields)).toEqual(
      expect.arrayContaining(['title', 'dueAt']),
    );

    const list = (await req(ctx.app, 'GET', tp.list(t.id), t.owner.token)).json().tasks;
    expect(list.map((x: { title: string }) => x.title)).toEqual(['להתקשר', 'לשלוח הצעת מחיר']);
  });

  it('links a task to a lead; creating and completing it lands in the lead history', async () => {
    const t = await team();
    const l = await lead(t.id, t.owner.token);
    const task = (
      await create(t.id, t.owner.token, { title: 'לחזור ללקוח', dueAt: inHours(1), leadId: l.id })
    ).json().task;
    expect(task.lead).toEqual({ id: l.id, name: 'רון לוי' });

    const done = await req(ctx.app, 'PATCH', tp.task(t.id, task.id), t.owner.token, {
      status: 'DONE',
    });
    expect(done.json().task).toMatchObject({ status: 'DONE', completedAt: expect.any(String) });
    const reopened = await req(ctx.app, 'PATCH', tp.task(t.id, task.id), t.owner.token, {
      status: 'OPEN',
    });
    expect(reopened.json().task.completedAt).toBeNull();

    const history = (await req(ctx.app, 'GET', lp.detail(t.id, l.id), t.owner.token)).json()
      .activities;
    expect(history.map((a: { type: string }) => a.type)).toEqual(
      expect.arrayContaining(['task.created', 'task.completed']),
    );
    expect(
      (await req(ctx.app, 'GET', `${tp.list(t.id)}?leadId=${l.id}`, t.owner.token)).json().tasks,
    ).toHaveLength(1);
  });

  it('filters overdue and "mine"', async () => {
    const t = await team();
    await create(t.id, t.owner.token, { title: 'באיחור', dueAt: inHours(-3) });
    await create(t.id, t.owner.token, {
      title: 'של העובד',
      dueAt: inHours(5),
      assigneeId: t.emp.userId,
    });
    const titles = async (qs: string) =>
      (await req(ctx.app, 'GET', `${tp.list(t.id)}?${qs}`, t.owner.token))
        .json()
        .tasks.map((x: { title: string }) => x.title);
    expect(await titles('due=overdue')).toEqual(['באיחור']);
    expect(await titles('assigneeId=me')).toEqual(['באיחור']);
    expect(await titles(`assigneeId=${t.emp.userId}`)).toEqual(['של העובד']);
  });

  it("employees see and change only their own tasks, can't assign others or link others' leads", async () => {
    const t = await team();
    const ownerTask = (
      await create(t.id, t.owner.token, { title: 'של הבעלים', dueAt: inHours(1) })
    ).json().task;
    const empTask = (
      await create(t.id, t.owner.token, {
        title: 'של העובד',
        dueAt: inHours(1),
        assigneeId: t.emp.userId,
      })
    ).json().task;

    const mine = (await req(ctx.app, 'GET', tp.list(t.id), t.emp.token)).json().tasks;
    expect(mine.map((x: { id: string }) => x.id)).toEqual([empTask.id]);
    expect(
      (await req(ctx.app, 'PATCH', tp.task(t.id, ownerTask.id), t.emp.token, { status: 'DONE' }))
        .statusCode,
    ).toBe(404);
    expect(
      (await req(ctx.app, 'DELETE', tp.task(t.id, ownerTask.id), t.emp.token)).statusCode,
    ).toBe(404);
    expect(
      (await req(ctx.app, 'PATCH', tp.task(t.id, empTask.id), t.emp.token, { status: 'DONE' }))
        .statusCode,
    ).toBe(200);

    expect(
      (
        await create(t.id, t.emp.token, {
          title: 'x',
          dueAt: inHours(1),
          assigneeId: t.owner.userId,
        })
      ).statusCode,
    ).toBe(403);
    const ownersLead = await lead(t.id, t.owner.token);
    const linked = await create(t.id, t.emp.token, {
      title: 'x',
      dueAt: inHours(1),
      leadId: ownersLead.id,
    });
    expect(linked.statusCode).toBe(400);
    expect(linked.json().error.fields.leadId).toBeTruthy();
    const own = await create(t.id, t.emp.token, { title: 'שלי', dueAt: inHours(1) });
    expect(own.json().task.assignee.id).toBe(t.emp.userId);
  });

  it('rejects assignees and leads from outside the business', async () => {
    const t = await team();
    const other = await ownerWithBusiness(ctx.app, 'other');
    const foreignLead = await lead(other.business.id, other.token, { phone: '052-9998877' });
    expect(
      (
        await create(t.id, t.owner.token, {
          title: 'x',
          dueAt: inHours(1),
          assigneeId: other.userId,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await create(t.id, t.owner.token, { title: 'x', dueAt: inHours(1), leadId: foreignLead.id }))
        .statusCode,
    ).toBe(400);
  });

  describe('reminders', () => {
    const service = () => new TaskService(ctx.prisma);
    const send = (now = new Date()) =>
      service().sendDueReminders(ctx.email, ctx.app.config, ctx.app.log, now);

    it('emails the assignee once when due; skips future, done, muted and stale tasks', async () => {
      const t = await team();
      const l = await lead(t.id, t.owner.token);
      await create(t.id, t.owner.token, {
        title: 'להתקשר לרון',
        dueAt: inHours(-0.1),
        assigneeId: t.emp.userId,
        leadId: l.id,
      });
      await create(t.id, t.owner.token, { title: 'עתידי', dueAt: inHours(3) });
      await create(t.id, t.owner.token, { title: 'מושתק', dueAt: inHours(-0.1), remind: false });
      await create(t.id, t.owner.token, { title: 'ישן מאוד', dueAt: inHours(-48) });
      const done = (
        await create(t.id, t.owner.token, { title: 'הושלם', dueAt: inHours(-0.1) })
      ).json().task;
      await req(ctx.app, 'PATCH', tp.task(t.id, done.id), t.owner.token, { status: 'DONE' });

      expect(await send()).toBe(1);
      expect(ctx.email.sent).toHaveLength(1);
      const mail = ctx.email.sent[0]!;
      expect(mail.subject).toBe('תזכורת: להתקשר לרון');
      expect(mail.text).toContain('ליד: רון לוי');
      expect(mail.text).toContain(`/b/${t.id}/leads/${l.id}`);
      expect(await send()).toBe(0); // once only
    });

    it('a new due time re-arms the reminder; removed members get none', async () => {
      const t = await team();
      const task = (
        await create(t.id, t.owner.token, {
          title: 'שוב',
          dueAt: inHours(-0.1),
          assigneeId: t.emp.userId,
        })
      ).json().task;
      expect(await send()).toBe(1);
      await req(ctx.app, 'PATCH', tp.task(t.id, task.id), t.owner.token, { dueAt: inHours(-0.05) });
      await ctx.prisma.membership.updateMany({
        where: { userId: t.emp.userId },
        data: { status: 'DISABLED' },
      });
      expect(await send()).toBe(0);
      await ctx.prisma.membership.updateMany({
        where: { userId: t.emp.userId },
        data: { status: 'ACTIVE' },
      });
      await req(ctx.app, 'PATCH', tp.task(t.id, task.id), t.owner.token, { dueAt: inHours(-0.02) });
      expect(await send()).toBe(1);
    });

    it('shows the due time in the business time zone', async () => {
      const t = await team();
      await create(t.id, t.owner.token, { title: 'בדיקת שעה', dueAt: '2026-10-27T08:00:00.000Z' });
      await send(new Date('2026-10-27T08:01:00.000Z'));
      expect(ctx.email.sent[0]!.text).toMatch(/10:00/); // Israel is UTC+2 on this date
    });
  });
});
