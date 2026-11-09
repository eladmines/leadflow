import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { apiPaths } from '@leadflow/shared';
import { createTestApp, resetDb } from '../../../test/helpers';
import { addMember, newUser, ownerWithBusiness, req } from '../../../test/business-helpers';

const lp = apiPaths.leads;
const cp = apiPaths.customers;

describe('paying customers (D-163)', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());
  beforeEach(() => resetDb(ctx.prisma));

  async function setup() {
    const o = await ownerWithBusiness(ctx.app, 'cust');
    const id = o.business.id;
    const stages = (await req(ctx.app, 'GET', lp.pipeline(id), o.token)).json().stages;
    const won = stages.find((s: { kind: string }) => s.kind === 'WON').id;
    const lead = async (name: string, phone: string, value: number | null, isWon: boolean) => {
      const created = (
        await req(ctx.app, 'POST', lp.list(id), o.token, { name, phone, expectedValue: value })
      ).json().lead;
      if (isWon) await req(ctx.app, 'PATCH', lp.detail(id, created.id), o.token, { stageId: won });
      return created;
    };
    return { o, id, lead };
  }

  it('lists only people who bought, one row each with their purchases, newest first', async () => {
    const { o, id, lead } = await setup();
    const first = await lead('דנה כהן', '052-1111111', 1000, true);
    await lead('יוסי לוי', '052-2222222', 500, false);
    // Dana buys again (same phone → same contact).
    const second = await lead('דנה כהן', '052-1111111', 1500, true);
    await ctx.prisma.lead.update({
      where: { id: first.id },
      data: {
        attribution: { source: 'meta_ads', seenAt: new Date().toISOString() },
        attributionSource: 'meta_ads',
      },
    });
    await ctx.prisma.lead.update({
      where: { id: second.id },
      data: { attribution: { source: 'google_ads', seenAt: new Date().toISOString() } },
    });

    const res = await req(ctx.app, 'GET', cp.list(id), o.token);
    expect(res.statusCode).toBe(200);
    const { customers } = res.json();
    expect(customers).toHaveLength(1);
    expect(customers[0]).toMatchObject({
      name: 'דנה כהן',
      phone: '+972521111111',
      totalValue: 2500,
      // Where they first came from.
      attribution: { source: 'meta_ads' },
    });
    expect(customers[0].purchases.map((p: { leadId: string }) => p.leadId)).toEqual([
      second.id,
      first.id,
    ]);
    expect(customers[0].purchases[0]).toMatchObject({ value: 1500, via: 'won' });

    expect(
      (await req(ctx.app, 'GET', `${cp.list(id)}?q=דנה`, o.token)).json().customers,
    ).toHaveLength(1);
    expect(
      (await req(ctx.app, 'GET', `${cp.list(id)}?q=יוסי`, o.token)).json().customers,
    ).toHaveLength(0);
  });

  it('an accepted quote makes a customer; employees see only their own; outsiders 404', async () => {
    const { o, id, lead } = await setup();
    const open = await lead('רוני', '052-3333333', 800, false);
    await ctx.prisma.quote.create({
      data: {
        businessId: id,
        leadId: open.id,
        number: 1,
        items: [],
        status: 'ACCEPTED',
        decidedAt: new Date(),
      },
    });
    expect((await req(ctx.app, 'GET', cp.list(id), o.token)).json().customers[0]).toMatchObject({
      name: 'רוני',
      purchases: [{ via: 'quote', value: 800 }],
    });

    const employee = await newUser(ctx.app, 'cust-emp');
    await addMember(ctx.prisma, id, employee.userId, 'EMPLOYEE');
    expect((await req(ctx.app, 'GET', cp.list(id), employee.token)).json().customers).toEqual([]);

    const other = await ownerWithBusiness(ctx.app, 'cust-other');
    expect((await req(ctx.app, 'GET', cp.list(id), other.token)).statusCode).toBe(404);
  });
});
