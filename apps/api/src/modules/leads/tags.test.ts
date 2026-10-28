import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { apiPaths } from '@leadflow/shared';
import { createTestApp, resetDb } from '../../../test/helpers';
import { addMember, newUser, ownerWithBusiness, req } from '../../../test/business-helpers';

const lp = apiPaths.leads;

describe('lead tags', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());
  beforeEach(() => resetDb(ctx.prisma));

  const create = (id: string, token: string, body: object) =>
    req(ctx.app, 'POST', lp.list(id), token, body);

  it('saves tags (trimmed, de-duplicated), logs the change, filters and suggests', async () => {
    const o = await ownerWithBusiness(ctx.app);
    const id = o.business.id;
    const a = (await create(id, o.token, { name: 'רון', phone: '052-0000001' })).json().lead;
    const b = (await create(id, o.token, { name: 'דנה', phone: '052-0000002' })).json().lead;
    expect(a.tags).toEqual([]);

    const res = await req(ctx.app, 'PATCH', lp.detail(id, a.id), o.token, {
      tags: [' VIP ', 'חוזר', 'vip'],
    });
    expect(res.json().lead.tags).toEqual(['VIP', 'חוזר']);
    await req(ctx.app, 'PATCH', lp.detail(id, b.id), o.token, { tags: ['VIP'] });

    const detail = (await req(ctx.app, 'GET', lp.detail(id, a.id), o.token)).json();
    expect(detail.activities[0]).toMatchObject({
      type: 'lead.updated',
      data: { fields: ['tags'] },
    });

    const names = async (qs: string) =>
      (await req(ctx.app, 'GET', `${lp.list(id)}?${qs}`, o.token))
        .json()
        .leads.map((l: { contact: { name: string } }) => l.contact.name);
    expect(await names(`tag=${encodeURIComponent('חוזר')}`)).toEqual(['רון']);
    expect((await names('tag=VIP')).sort()).toEqual(['דנה', 'רון']);

    expect((await req(ctx.app, 'GET', lp.tags(id), o.token)).json().tags).toEqual(['VIP', 'חוזר']);
  });

  it('rejects too many or too long tags with Hebrew messages', async () => {
    const o = await ownerWithBusiness(ctx.app);
    const id = o.business.id;
    const lead = (await create(id, o.token, { name: 'רון', phone: '052-0000001' })).json().lead;
    const many = await req(ctx.app, 'PATCH', lp.detail(id, lead.id), o.token, {
      tags: Array.from({ length: 11 }, (_, i) => `t${i}`),
    });
    expect(many.statusCode).toBe(400);
    expect(JSON.stringify(many.json())).toContain('עד 10 תגיות');
    const long = await req(ctx.app, 'PATCH', lp.detail(id, lead.id), o.token, {
      tags: ['x'.repeat(31)],
    });
    expect(long.statusCode).toBe(400);
  });

  it('employees only get suggestions from leads assigned to them', async () => {
    const o = await ownerWithBusiness(ctx.app, 'owner');
    const id = o.business.id;
    const emp = await newUser(ctx.app, 'emp');
    await addMember(ctx.prisma, id, emp.userId, 'EMPLOYEE');
    const mine = (
      await create(id, o.token, { name: 'שלי', phone: '052-0000001', ownerId: emp.userId })
    ).json().lead;
    const other = (await create(id, o.token, { name: 'אחר', phone: '052-0000002' })).json().lead;
    await req(ctx.app, 'PATCH', lp.detail(id, mine.id), o.token, { tags: ['שלי'] });
    await req(ctx.app, 'PATCH', lp.detail(id, other.id), o.token, { tags: ['סודי'] });
    expect((await req(ctx.app, 'GET', lp.tags(id), emp.token)).json().tags).toEqual(['שלי']);
  });
});
