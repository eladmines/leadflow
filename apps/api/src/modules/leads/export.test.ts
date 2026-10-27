import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { apiPaths } from '@leadflow/shared';
import { createTestApp, resetDb } from '../../../test/helpers';
import { addMember, newUser, ownerWithBusiness, req } from '../../../test/business-helpers';

const lp = apiPaths.leads;

describe('leads CSV export', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());
  beforeEach(() => resetDb(ctx.prisma));

  it('exports visible leads as Excel-friendly CSV with Hebrew headers and safe cells', async () => {
    const o = await ownerWithBusiness(ctx.app);
    const id = o.business.id;
    await req(ctx.app, 'POST', lp.list(id), o.token, {
      name: 'דנה, כהן',
      phone: '052-7654321',
      expectedValue: 1500,
      message: 'שורה ראשונה\nשורה "שנייה"',
    });
    await req(ctx.app, 'POST', lp.list(id), o.token, {
      name: '=HYPERLINK("http://evil","x")',
      email: 'x@example.com',
    });

    const res = await req(ctx.app, 'GET', lp.exportCsv(id), o.token);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toMatch(
      /^attachment; filename="leadflow-leads-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    const body = res.body;
    expect(body.charCodeAt(0)).toBe(0xfeff);
    const [header] = body.slice(1).split('\r\n');
    expect(header).toBe('שם,טלפון,אימייל,שלב,מקור,אחראי,ערך משוער (₪),טיפול הבא,פרטי הפנייה,נוצר');
    expect(body).toContain(
      '"דנה, כהן",052-7654321,,חדש,הוזן ידנית,,1500,,"שורה ראשונה\nשורה ""שנייה""",',
    );
    expect(body).toContain(`"'=HYPERLINK(""http://evil"",""x"")"`);
    expect(
      await ctx.prisma.auditLog.findFirst({ where: { action: 'leads.exported' } }),
    ).toMatchObject({ metadata: { count: 2 } });
  });

  it('applies the same filters as the list', async () => {
    const o = await ownerWithBusiness(ctx.app);
    const id = o.business.id;
    await req(ctx.app, 'POST', lp.list(id), o.token, { name: 'דנה', phone: '052-7654321' });
    await req(ctx.app, 'POST', lp.list(id), o.token, { name: 'רון', phone: '054-1112233' });
    const res = await req(
      ctx.app,
      'GET',
      `${lp.exportCsv(id)}?q=${encodeURIComponent('רון')}`,
      o.token,
    );
    const rows = res.body.trim().split('\r\n');
    expect(rows).toHaveLength(2); // header + Ron
    expect(rows[1]).toMatch(/^רון,/);
  });

  it('only the owner can export (PRD §20)', async () => {
    const o = await ownerWithBusiness(ctx.app);
    for (const role of ['MANAGER', 'EMPLOYEE'] as const) {
      const u = await newUser(ctx.app, role.toLowerCase());
      await addMember(ctx.prisma, o.business.id, u.userId, role);
      expect((await req(ctx.app, 'GET', lp.exportCsv(o.business.id), u.token)).statusCode).toBe(
        403,
      );
    }
  });
});
