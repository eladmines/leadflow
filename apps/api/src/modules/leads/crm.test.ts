import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { apiPaths } from '@leadflow/shared';
import { createTestApp, resetDb } from '../../../test/helpers';
import { addMember, newUser, ownerWithBusiness, req } from '../../../test/business-helpers';

const lp = apiPaths.leads;

describe('CRM (F08)', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());
  beforeEach(() => resetDb(ctx.prisma));

  async function team() {
    const owner = await ownerWithBusiness(ctx.app, 'owner');
    const id = owner.business.id;
    const manager = await newUser(ctx.app, 'mgr');
    const employee = await newUser(ctx.app, 'emp');
    await addMember(ctx.prisma, id, manager.userId, 'MANAGER');
    await addMember(ctx.prisma, id, employee.userId, 'EMPLOYEE');
    const stages = (await req(ctx.app, 'GET', lp.pipeline(id), owner.token)).json().stages;
    return { owner, manager, employee, id, stages };
  }
  const create = (id: string, token: string, body: object) =>
    req(ctx.app, 'POST', lp.list(id), token, body);

  it('seeds the default Hebrew pipeline in order', async () => {
    const { stages } = await team();
    expect(stages.map((s: { name: string }) => s.name)).toEqual([
      'חדש',
      'נוצר קשר',
      'הצעה נשלחה',
      'ממתין',
      'נסגר',
      'אבוד',
    ]);
    expect(stages.at(-2).kind).toBe('WON');
  });

  it('creates a manual lead, requiring a phone or email, and reuses a matching contact', async () => {
    const t = await team();
    const bad = await create(t.id, t.owner.token, { name: 'רון' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.fields.phone).toMatch(/טלפון או אימייל/);

    const res = await create(t.id, t.owner.token, {
      name: 'רון לוי',
      phone: '052-1112233',
      expectedValue: 1500,
      message: 'הגיע מהמלצה',
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().lead).toMatchObject({
      source: 'manual',
      stage: { name: 'חדש' },
      owner: null,
      expectedValue: 1500,
      contact: { name: 'רון לוי', phone: '+972521112233' },
    });
    await create(t.id, t.owner.token, { name: 'רוני', phone: '0521112233' });
    expect(await ctx.prisma.contact.count()).toBe(1);
    expect(await ctx.prisma.lead.count()).toBe(2);
  });

  it('warns about duplicates to owners/managers only', async () => {
    const t = await team();
    await create(t.id, t.owner.token, { name: 'רון לוי', phone: '052-1112233' });
    const q = `${lp.duplicates(t.id)}?phone=${encodeURIComponent('+972 52 111 2233')}`;
    const forManager = (await req(ctx.app, 'GET', q, t.manager.token)).json().contacts;
    expect(forManager).toEqual([expect.objectContaining({ name: 'רון לוי', leadCount: 1 })]);
    expect((await req(ctx.app, 'GET', q, t.employee.token)).json().contacts).toEqual([]);
  });

  it('moves stages, assigns, edits fields — each recorded in the history with the actor', async () => {
    const t = await team();
    const lead = (await create(t.id, t.owner.token, { name: 'רון', phone: '052-1112233' })).json()
      .lead;
    const url = lp.detail(t.id, lead.id);

    const patched = await req(ctx.app, 'PATCH', url, t.manager.token, {
      stageId: t.stages[1].id,
      ownerId: t.employee.userId,
      expectedValue: 2000,
      nextActionAt: '2026-11-01T09:00:00.000Z',
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().lead).toMatchObject({
      stage: { name: 'נוצר קשר' },
      owner: { id: t.employee.userId },
      expectedValue: 2000,
      nextActionAt: '2026-11-01T09:00:00.000Z',
    });

    const note = await req(ctx.app, 'POST', lp.notes(t.id, lead.id), t.manager.token, {
      text: 'דיברנו, שולחים הצעה',
    });
    expect(note.statusCode).toBe(201);

    const detail = (await req(ctx.app, 'GET', url, t.owner.token)).json();
    const types = detail.activities.map((a: { type: string }) => a.type);
    expect(types).toEqual(
      expect.arrayContaining([
        'lead.created',
        'lead.stage_changed',
        'lead.assigned',
        'lead.updated',
        'lead.note',
      ]),
    );
    const stageChange = detail.activities.find(
      (a: { type: string }) => a.type === 'lead.stage_changed',
    );
    expect(stageChange).toMatchObject({
      data: { from: 'חדש', to: 'נוצר קשר' },
      actor: { id: t.manager.userId },
    });
    expect(detail.activities[0]).toMatchObject({
      type: 'lead.note',
      data: { text: 'דיברנו, שולחים הצעה' },
    });

    // No-op patch adds nothing.
    await req(ctx.app, 'PATCH', url, t.manager.token, { stageId: t.stages[1].id });
    expect(
      await ctx.prisma.activity.count({ where: { leadId: lead.id, type: 'lead.stage_changed' } }),
    ).toBe(1);
  });

  it('employees see and update only leads assigned to them; they cannot assign (AC-10)', async () => {
    const t = await team();
    const mine = (
      await create(t.id, t.owner.token, {
        name: 'שלי',
        phone: '052-0000001',
        ownerId: t.employee.userId,
      })
    ).json().lead;
    const other = (
      await create(t.id, t.owner.token, { name: 'לא שלי', phone: '052-0000002' })
    ).json().lead;

    const list = (await req(ctx.app, 'GET', lp.list(t.id), t.employee.token)).json().leads;
    expect(list.map((l: { id: string }) => l.id)).toEqual([mine.id]);
    expect(
      (await req(ctx.app, 'GET', lp.detail(t.id, other.id), t.employee.token)).statusCode,
    ).toBe(404);
    expect(
      (
        await req(ctx.app, 'PATCH', lp.detail(t.id, other.id), t.employee.token, {
          stageId: t.stages[1].id,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await req(ctx.app, 'POST', lp.notes(t.id, other.id), t.employee.token, { text: 'x' }))
        .statusCode,
    ).toBe(404);

    expect(
      (
        await req(ctx.app, 'PATCH', lp.detail(t.id, mine.id), t.employee.token, {
          stageId: t.stages[2].id,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await req(ctx.app, 'PATCH', lp.detail(t.id, mine.id), t.employee.token, { ownerId: null }))
        .statusCode,
    ).toBe(403);

    // An employee's own manual lead is assigned to them (so they can see it).
    const own = (
      await create(t.id, t.employee.token, { name: 'חדש שלי', phone: '052-0000003' })
    ).json().lead;
    expect(own.owner.id).toBe(t.employee.userId);
    expect(
      (
        await create(t.id, t.employee.token, {
          name: 'אבי לוי',
          phone: '052-0000004',
          ownerId: t.manager.userId,
        })
      ).statusCode,
    ).toBe(403);
  });

  it('rejects stages and owners from outside the business', async () => {
    const t = await team();
    const other = await ownerWithBusiness(ctx.app, 'other');
    const foreignStages = (
      await req(ctx.app, 'GET', lp.pipeline(other.business.id), other.token)
    ).json().stages;
    const lead = (await create(t.id, t.owner.token, { name: 'רון', phone: '052-1112233' })).json()
      .lead;

    const stage = await req(ctx.app, 'PATCH', lp.detail(t.id, lead.id), t.owner.token, {
      stageId: foreignStages[0].id,
    });
    expect(stage.statusCode).toBe(400);
    expect(stage.json().error.fields.stageId).toBeTruthy();
    const owner = await req(ctx.app, 'PATCH', lp.detail(t.id, lead.id), t.owner.token, {
      ownerId: other.userId,
    });
    expect(owner.statusCode).toBe(400);
    expect(owner.json().error.fields.ownerId).toBeTruthy();
    // And another business's lead id is simply not found.
    const theirs = (
      await create(other.business.id, other.token, { name: 'זר', phone: '052-9999999' })
    ).json().lead;
    expect((await req(ctx.app, 'GET', lp.detail(t.id, theirs.id), t.owner.token)).statusCode).toBe(
      404,
    );
  });

  it('searches by name, phone (any format) and email, and filters by stage/owner/source', async () => {
    const t = await team();
    await create(t.id, t.owner.token, {
      name: 'דנה כהן',
      phone: '052-7654321',
      email: 'dana@example.com',
    });
    const ron = (
      await create(t.id, t.owner.token, {
        name: 'רון לוי',
        phone: '054-1112233',
        ownerId: t.employee.userId,
      })
    ).json().lead;
    await req(ctx.app, 'PATCH', lp.detail(t.id, ron.id), t.owner.token, {
      stageId: t.stages[4].id,
    });

    const names = async (qs: string) =>
      (await req(ctx.app, 'GET', `${lp.list(t.id)}?${qs}`, t.owner.token))
        .json()
        .leads.map((l: { contact: { name: string } }) => l.contact.name);
    expect(await names('q=דנה')).toEqual(['דנה כהן']);
    expect(await names('q=0527654321')).toEqual(['דנה כהן']);
    expect(await names('q=765')).toEqual(['דנה כהן']);
    expect(await names('q=DANA@')).toEqual(['דנה כהן']);
    expect(await names(`stageId=${t.stages[4].id}`)).toEqual(['רון לוי']);
    expect(await names(`ownerId=${t.employee.userId}`)).toEqual(['רון לוי']);
    expect(await names('ownerId=none')).toEqual(['דנה כהן']);
    expect(await names('source=website_form')).toEqual([]);
    expect(
      (await req(ctx.app, 'GET', `${lp.list(t.id)}?stageId=nope`, t.owner.token)).statusCode,
    ).toBe(400);
  });
});
