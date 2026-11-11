import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { apiPaths, IMPORT_MAX_ROWS } from '@leadflow/shared';
import { createTestApp, resetDb } from '../../../test/helpers';
import { addMember, newUser, ownerWithBusiness, req } from '../../../test/business-helpers';

const cp = apiPaths.customers;

describe('import customers from a spreadsheet (D-179)', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());
  beforeEach(() => resetDb(ctx.prisma));

  it('creates a contact and a Won lead per row, so they show on the Customers page', async () => {
    const o = await ownerWithBusiness(ctx.app, 'imp');
    const id = o.business.id;
    const res = await req(ctx.app, 'POST', cp.import(id), o.token, {
      rows: [
        { name: 'דנה כהן', phone: '052-1111111', email: 'Dana@Example.com', value: '₪1,500' },
        { name: 'יוסי לוי', phone: '0522222222' },
        { name: 'רונית', email: 'ronit@example.com', value: '' },
      ],
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ imported: 3, duplicates: 0, invalid: [] });

    const customers = (await req(ctx.app, 'GET', cp.list(id), o.token)).json().customers;
    expect(customers).toHaveLength(3);
    const dana = customers.find((c: { name: string }) => c.name === 'דנה כהן');
    expect(dana).toMatchObject({
      phone: '+972521111111',
      email: 'dana@example.com',
      totalValue: 1500,
    });
    expect(await ctx.prisma.auditLog.count({ where: { action: 'customers.imported' } })).toBe(1);
  });

  it('skips people who are already customers or appear twice, and reports bad rows', async () => {
    const o = await ownerWithBusiness(ctx.app, 'imp2');
    const id = o.business.id;
    const first = await req(ctx.app, 'POST', cp.import(id), o.token, {
      rows: [{ name: 'דנה כהן', phone: '0521111111' }],
    });
    expect(first.json().imported).toBe(1);

    const res = await req(ctx.app, 'POST', cp.import(id), o.token, {
      rows: [
        { name: 'דנה כהן', phone: '+972521111111' }, // already a customer (same phone)
        { name: 'אבי', phone: '0523333333' },
        { name: 'אבי כהן', phone: '052-3333333' }, // same phone twice in the file
        { name: 'א', phone: '0524444444' }, // name too short
        { name: 'ללא פרטים' }, // no phone or email
        { name: 'טלפון שגוי', phone: 'abc' },
        { name: 'מייל שגוי', email: 'not-an-email' },
        { name: 'סכום שגוי', phone: '0525555555', value: '12abc' },
      ],
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.imported).toBe(1);
    expect(body.duplicates).toBe(2);
    expect(body.invalid.map((i: { row: number }) => i.row)).toEqual([4, 5, 6, 7, 8]);
    expect(await ctx.prisma.contact.count({ where: { businessId: id } })).toBe(2);
  });

  it('turns an existing lead contact into a customer without creating a second contact', async () => {
    const o = await ownerWithBusiness(ctx.app, 'imp3');
    const id = o.business.id;
    await req(ctx.app, 'POST', apiPaths.leads.list(id), o.token, {
      name: 'מיכל',
      phone: '0526666666',
    });
    expect((await req(ctx.app, 'GET', cp.list(id), o.token)).json().customers).toHaveLength(0);
    const res = await req(ctx.app, 'POST', cp.import(id), o.token, {
      rows: [{ name: 'מיכל', phone: '0526666666', value: '800' }],
    });
    expect(res.json()).toMatchObject({ imported: 1, duplicates: 0 });
    expect(await ctx.prisma.contact.count({ where: { businessId: id } })).toBe(1);
    expect((await req(ctx.app, 'GET', cp.list(id), o.token)).json().customers).toHaveLength(1);
  });

  it('is limited by role, size and tenant', async () => {
    const o = await ownerWithBusiness(ctx.app, 'imp4');
    const id = o.business.id;
    const row = { name: 'דנה', phone: '0527777777' };

    const manager = await newUser(ctx.app, 'imp-mgr');
    await addMember(ctx.prisma, id, manager.userId, 'MANAGER');
    expect(
      (await req(ctx.app, 'POST', cp.import(id), manager.token, { rows: [row] })).statusCode,
    ).toBe(200);

    const employee = await newUser(ctx.app, 'imp-emp');
    await addMember(ctx.prisma, id, employee.userId, 'EMPLOYEE');
    expect(
      (await req(ctx.app, 'POST', cp.import(id), employee.token, { rows: [row] })).statusCode,
    ).toBe(403);

    // Someone outside the business gets a 404, not a 403.
    const outsider = await ownerWithBusiness(ctx.app, 'imp-out');
    expect(
      (await req(ctx.app, 'POST', cp.import(id), outsider.token, { rows: [row] })).statusCode,
    ).toBe(404);

    expect((await req(ctx.app, 'POST', cp.import(id), o.token, { rows: [] })).statusCode).toBe(400);
    const tooMany = Array.from({ length: IMPORT_MAX_ROWS + 1 }, (_, i) => ({
      name: `לקוח ${i}`,
      phone: `05299${String(i).padStart(5, '0')}`,
    }));
    expect((await req(ctx.app, 'POST', cp.import(id), o.token, { rows: tooMany })).statusCode).toBe(
      400,
    );
  });
});
