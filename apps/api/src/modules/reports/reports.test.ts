import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { apiPaths } from '@leadflow/shared';
import { createTestApp, resetDb } from '../../../test/helpers';
import { addMember, newUser, ownerWithBusiness, req } from '../../../test/business-helpers';

const rp = apiPaths.reports;
const lp = apiPaths.leads;

describe('reports summary', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());
  beforeEach(() => resetDb(ctx.prisma));

  async function setup() {
    const o = await ownerWithBusiness(ctx.app);
    const id = o.business.id;
    const stages = (await req(ctx.app, 'GET', lp.pipeline(id), o.token)).json().stages;
    const mk = async (name: string, phone: string, value: number, stage: number, daysAgo = 0) => {
      const lead = (
        await req(ctx.app, 'POST', lp.list(id), o.token, { name, phone, expectedValue: value })
      ).json().lead;
      if (stage)
        await req(ctx.app, 'PATCH', lp.detail(id, lead.id), o.token, { stageId: stages[stage].id });
      if (daysAgo) {
        await ctx.prisma.lead.update({
          where: { id: lead.id },
          data: { createdAt: new Date(Date.now() - daysAgo * 86_400_000) },
        });
      }
      return lead;
    };
    return { o, id, mk };
  }

  it('counts leads, close rate, values, stages, sources and the series', async () => {
    const { o, id, mk } = await setup();
    await mk('נועה', '052-0000001', 1000, 0); // חדש (open)
    await mk('רון', '052-0000002', 2000, 4); // נסגר (won)
    await mk('דנה', '052-0000003', 500, 5); // אבוד (lost)
    await mk('ישן', '052-0000004', 700, 0, 40); // previous 30 days
    const res = await req(ctx.app, 'GET', `${rp.summary(id)}?days=30`, o.token);
    expect(res.statusCode).toBe(200);
    const r = res.json();
    expect(r.leads).toEqual({ current: 3, previous: 1 });
    expect(r.closeRate).toBe(0.5);
    expect(r.wonValue).toBe(2000);
    expect(r.openValue).toBe(1000);
    expect(r.byStage.map((s: { name: string; count: number }) => [s.name, s.count])).toEqual([
      ['חדש', 1],
      ['נוצר קשר', 0],
      ['הצעה נשלחה', 0],
      ['ממתין', 0],
      ['נסגר', 1],
      ['אבוד', 1],
    ]);
    expect(r.bySource).toEqual([
      { source: 'website_form', count: 0 },
      { source: 'manual', count: 3 },
      { source: 'whatsapp', count: 0 },
    ]);
    expect(r.series.unit).toBe('day');
    expect(r.series.points.length).toBeGreaterThanOrEqual(30);
    expect(r.series.points.reduce((a: number, p: { count: number }) => a + p.count, 0)).toBe(3);
    const dates = r.series.points.map((p: { date: string }) => p.date);
    expect([...dates].sort()).toEqual(dates); // chronological, no stray buckets
  });

  it('measures response time from the first human action (moving a stage counts)', async () => {
    const { o, id, mk } = await setup();
    const lead = await mk('רון', '052-0000002', 0, 0);
    await ctx.prisma.lead.update({
      where: { id: lead.id },
      data: { createdAt: new Date(Date.now() - 90 * 60_000) },
    });
    await req(ctx.app, 'POST', lp.notes(id, lead.id), o.token, { text: 'התקשרתי' });
    await mk('בלי מענה', '052-0000009', 0, 0);
    const r = (await req(ctx.app, 'GET', rp.summary(id), o.token)).json();
    expect(r.respondedLeads).toBe(1);
    expect(r.avgResponseMinutes).toBeGreaterThanOrEqual(89);
    expect(r.avgResponseMinutes).toBeLessThanOrEqual(91);
  });

  it('uses weekly buckets for 90 days, rejects other ranges, and is empty-safe', async () => {
    const { o, id } = await setup();
    const r = (await req(ctx.app, 'GET', `${rp.summary(id)}?days=90`, o.token)).json();
    expect(r.series.unit).toBe('week');
    expect(r.series.points.length).toBeGreaterThanOrEqual(13);
    expect(r.closeRate).toBeNull();
    expect(r.avgResponseMinutes).toBeNull();
    expect((await req(ctx.app, 'GET', `${rp.summary(id)}?days=12`, o.token)).statusCode).toBe(400);
  });

  it('managers can see reports; employees cannot', async () => {
    const { o, id } = await setup();
    for (const [role, status] of [
      ['MANAGER', 200],
      ['EMPLOYEE', 403],
    ] as const) {
      const u = await newUser(ctx.app, role.toLowerCase());
      await addMember(ctx.prisma, id, u.userId, role);
      expect((await req(ctx.app, 'GET', rp.summary(id), u.token)).statusCode).toBe(status);
    }
    expect(o).toBeTruthy();
  });
});
