import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { apiPaths } from '@leadflow/shared';
import { createTestApp, resetDb } from '../../../test/helpers';
import { addMember, newUser, ownerWithBusiness, req } from '../../../test/business-helpers';

const lp = apiPaths.leads;

describe('deleting a lead', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());
  beforeEach(() => resetDb(ctx.prisma));

  const create = (id: string, token: string, body: object) =>
    req(ctx.app, 'POST', lp.list(id), token, body);

  it('removes the lead, its history and an orphaned contact; keeps tasks unlinked; audits', async () => {
    const o = await ownerWithBusiness(ctx.app);
    const id = o.business.id;
    const first = (await create(id, o.token, { name: 'רון', phone: '052-1112233' })).json().lead;
    const second = (await create(id, o.token, { name: 'רון', phone: '052-1112233' })).json().lead;
    await req(ctx.app, 'POST', lp.notes(id, first.id), o.token, { text: 'פרטי' });
    await req(ctx.app, 'POST', apiPaths.tasks.list(id), o.token, {
      title: 'להתקשר',
      dueAt: new Date(Date.now() + 3_600_000).toISOString(),
      leadId: first.id,
    });

    const del = await req(ctx.app, 'DELETE', lp.detail(id, first.id), o.token);
    expect(del.statusCode).toBe(204);
    expect((await req(ctx.app, 'GET', lp.detail(id, first.id), o.token)).statusCode).toBe(404);
    expect(await ctx.prisma.activity.count({ where: { leadId: first.id } })).toBe(0);
    expect(await ctx.prisma.contact.count()).toBe(1); // still used by the second lead
    expect((await ctx.prisma.task.findFirstOrThrow()).leadId).toBeNull();

    await req(ctx.app, 'DELETE', lp.detail(id, second.id), o.token);
    expect(await ctx.prisma.contact.count()).toBe(0);
    const audits = await ctx.prisma.auditLog.findMany({ where: { action: 'lead.deleted' } });
    expect(audits.map((a) => a.metadata)).toEqual([
      { contactRemoved: false },
      { contactRemoved: true },
    ]);
  });

  it('is owner-only, and a lead of another business is not found', async () => {
    const o = await ownerWithBusiness(ctx.app, 'owner');
    const id = o.business.id;
    const lead = (await create(id, o.token, { name: 'רון', phone: '052-1112233' })).json().lead;
    const manager = await newUser(ctx.app, 'mgr');
    await addMember(ctx.prisma, id, manager.userId, 'MANAGER');
    expect((await req(ctx.app, 'DELETE', lp.detail(id, lead.id), manager.token)).statusCode).toBe(
      403,
    );
    const other = await ownerWithBusiness(ctx.app, 'other');
    expect(
      (await req(ctx.app, 'DELETE', lp.detail(other.business.id, lead.id), other.token)).statusCode,
    ).toBe(404);
    expect(await ctx.prisma.lead.count()).toBe(1);
  });
});
