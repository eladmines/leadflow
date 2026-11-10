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

  it('people who booked are customers too: confirmed, done, missed or cancelled, not requests (D-178)', async () => {
    const { o, id, lead } = await setup();
    const day = 86_400_000;
    const contact = (name: string, phone: string) =>
      ctx.prisma.contact.create({ data: { businessId: id, name, phone } });
    const book = (
      contactId: string,
      status: 'REQUESTED' | 'CONFIRMED' | 'COMPLETED' | 'NO_SHOW' | 'CANCELLED',
      days: number,
      staffId: string | null = o.userId,
    ) =>
      ctx.prisma.appointment.create({
        data: {
          businessId: id,
          contactId,
          staffId,
          status,
          startsAt: new Date(Date.now() + days * day),
          endsAt: new Date(Date.now() + days * day + 1_800_000),
        },
      });
    const service = await ctx.prisma.service.create({
      data: { businessId: id, name: 'תספורת', durationMin: 30 },
    });

    const dana = await contact('דנה כהן', '+972521111111');
    await book(dana.id, 'COMPLETED', -3);
    const cancelled = await book(dana.id, 'CANCELLED', 2);
    await ctx.prisma.appointment.update({
      where: { id: cancelled.id },
      data: { serviceId: service.id },
    });
    const yossi = await contact('יוסי לוי', '+972522222222');
    await book(yossi.id, 'REQUESTED', 1);
    const noa = await contact('נועה', '+972523333333');
    await book(noa.id, 'CONFIRMED', 5, null);
    // Also someone who bought: shown once, with both.
    const bought = await lead('רונית', '052-4444444', 900, true);
    const ronit = bought.contact.id as string;
    await book(ronit, 'CONFIRMED', 1);

    const { customers } = (await req(ctx.app, 'GET', cp.list(id), o.token)).json();
    const names = customers.map((c: { name: string }) => c.name);
    expect(names).toContain('דנה כהן');
    expect(names).toContain('נועה');
    expect(names).toContain('רונית');
    // A request that still waits for approval isn't a booking.
    expect(names).not.toContain('יוסי לוי');
    const d = customers.find((c: { name: string }) => c.name === 'דנה כהן');
    expect(d).toMatchObject({ totalValue: 0, lastPurchaseAt: null, purchases: [] });
    expect(d.bookings.map((b: { status: string }) => b.status)).toEqual(['CANCELLED', 'COMPLETED']);
    expect(d.bookings[0].serviceName).toBe('תספורת');
    const r = customers.find((c: { name: string }) => c.name === 'רונית');
    expect(r.purchases).toHaveLength(1);
    expect(r.bookings).toHaveLength(1);
    expect(r.totalValue).toBe(900);

    // Search covers them too.
    expect(
      (await req(ctx.app, 'GET', `${cp.list(id)}?q=נועה`, o.token)).json().customers,
    ).toHaveLength(1);

    // An employee sees only the bookings they hold themselves.
    const employee = await newUser(ctx.app, 'cust-emp2');
    await addMember(ctx.prisma, id, employee.userId, 'EMPLOYEE');
    const mine = await contact('לקוח של העובד', '+972525555555');
    await book(mine.id, 'CONFIRMED', 1, employee.userId);
    const seen = (await req(ctx.app, 'GET', cp.list(id), employee.token)).json().customers;
    expect(seen.map((c: { name: string }) => c.name)).toEqual(['לקוח של העובד']);
  });
});
