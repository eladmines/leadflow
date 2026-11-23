import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { apiPaths, notificationText } from '@simplecatch/shared';
import { createTestApp, resetDb } from '../../../test/helpers';
import { addMember, newUser, ownerWithBusiness, req } from '../../../test/business-helpers';
import { MemoryDomainExpiry } from '../../integrations/domain';
import { daysUntil, DomainExpiryService, reminderDue } from './service';

const DAY = 86_400_000;
const NOW = new Date('2026-11-23T12:00:00Z');
const inDays = (n: number) => new Date(NOW.getTime() + n * DAY);

describe('domain expiry reminders (F33)', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let provider: MemoryDomainExpiry;
  let service: DomainExpiryService;

  beforeAll(async () => {
    provider = new MemoryDomainExpiry();
    ctx = await createTestApp({ domainExpiry: provider });
    service = new DomainExpiryService(ctx.prisma, provider, ctx.email, ctx.app.config, ctx.app.log);
  });
  afterAll(async () => ctx.close());
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    ctx.email.clear();
    for (const d of ['shiran.co.il', 'example.com']) provider.set(d, { status: 'unsupported' });
    provider.asked.length = 0;
  });

  const withSite = async (url: string | null = 'https://www.shiran.co.il/') => {
    const o = await ownerWithBusiness(ctx.app, 'dom');
    await ctx.prisma.business.update({ where: { id: o.business.id }, data: { websiteUrl: url } });
    return o;
  };
  const row = (id: string) =>
    ctx.prisma.business.findUniqueOrThrow({
      where: { id },
      select: {
        domainCheck: true,
        domainExpiresAt: true,
        domainCheckedAt: true,
        domainRemindedDays: true,
      },
    });
  // The sign-up emails are in the same mailbox.
  const mails = () => ctx.email.sent.filter((m) => m.subject.includes('shiran.co.il'));
  const bell = (id: string) =>
    ctx.prisma.notification.findMany({ where: { businessId: id, type: 'domain.expiring' } });

  it('picks the tightest reminder that is due', () => {
    expect([200, 61, 60, 59, 30, 29, 8, 7, 6, 1, 0, -3].map(reminderDue)).toEqual([
      null,
      null,
      60,
      60,
      30,
      30,
      30,
      7,
      7,
      7,
      0,
      0,
    ]);
    expect(daysUntil(new Date(NOW.getTime() + 6.2 * DAY), NOW)).toBe(7);
  });

  it('reads the date, and reminds once per threshold: the bell and an email to the owner', async () => {
    const o = await withSite();
    const id = o.business.id;
    provider.set('shiran.co.il', { status: 'ok', expiresAt: inDays(200) });
    await service.check(id, NOW);
    expect(provider.asked).toEqual(['shiran.co.il']);
    expect(await row(id)).toMatchObject({ domainCheck: 'ok', domainRemindedDays: null });
    expect(await bell(id)).toHaveLength(0);

    // 25 days left: the 30-day reminder, once, however often it is looked at.
    provider.set('shiran.co.il', { status: 'ok', expiresAt: inDays(25) });
    await service.check(id, NOW);
    await service.check(id, new Date(NOW.getTime() + 20 * 3_600_000));
    expect(await bell(id)).toHaveLength(1);
    expect(mails()).toHaveLength(1);
    expect(mails()[0]!.subject).toContain('25');
    expect(
      notificationText({ type: 'domain.expiring', data: (await bell(id))[0]!.data as never }),
    ).toMatchObject({ title: 'הדומיין של האתר עומד לפוג', body: 'shiran.co.il · פג בעוד 25 ימים' });
    expect((await row(id)).domainRemindedDays).toBe(30);

    // A week before, then the day itself, then after it passed: each once.
    provider.set('shiran.co.il', { status: 'ok', expiresAt: inDays(25) });
    await service.check(id, inDays(19));
    expect(await bell(id)).toHaveLength(2);
    await service.check(id, inDays(25));
    await service.check(id, inDays(27));
    expect(await bell(id)).toHaveLength(3);
    expect(mails()).toHaveLength(3);
    const expired = (await bell(id)).map((n) =>
      notificationText({ type: 'domain.expiring', data: n.data as never }),
    );
    expect(
      expired.some((t) => t.title === 'הדומיין של האתר פג' || t.body.endsWith('פג היום')),
    ).toBe(true);
  });

  it('a renewal starts the reminders over', async () => {
    const o = await withSite();
    const id = o.business.id;
    provider.set('shiran.co.il', { status: 'ok', expiresAt: inDays(5) });
    await service.check(id, NOW);
    expect((await row(id)).domainRemindedDays).toBe(7);
    provider.set('shiran.co.il', { status: 'ok', expiresAt: inDays(5 + 365) });
    await service.check(id, inDays(1));
    expect(await row(id)).toMatchObject({ domainCheck: 'ok', domainRemindedDays: null });
    provider.set('shiran.co.il', { status: 'ok', expiresAt: inDays(5 + 365) });
    await service.check(id, inDays(340));
    expect((await bell(id)).length).toBe(2); // 7 days before the first expiry, 60 before the new one
  });

  it('an unsupported ending is said so; a registry that did not answer keeps the old date', async () => {
    const o = await withSite('https://example.xyz');
    await service.check(o.business.id, NOW);
    expect(await row(o.business.id)).toMatchObject({
      domainCheck: 'unsupported',
      domainExpiresAt: null,
    });

    const p = await withSite();
    provider.set('shiran.co.il', { status: 'ok', expiresAt: inDays(100) });
    await service.check(p.business.id, NOW);
    provider.set('shiran.co.il', { status: 'failed' });
    await service.check(p.business.id, inDays(1));
    const r = await row(p.business.id);
    expect(r.domainCheck).toBe('ok');
    expect(r.domainExpiresAt?.toISOString()).toBe(inDays(100).toISOString());
    // With no date yet, a failure is a failure.
    const q = await withSite();
    provider.set('shiran.co.il', { status: 'failed' });
    await service.check(q.business.id, NOW);
    expect(await row(q.business.id)).toMatchObject({
      domainCheck: 'failed',
      domainExpiresAt: null,
    });
  });

  it('the daily job asks only about domains not asked lately, and only with a website', async () => {
    const a = await withSite();
    const b = await withSite();
    await withSite(null);
    provider.set('shiran.co.il', { status: 'ok', expiresAt: inDays(300) });
    expect(await service.checkDue(NOW)).toBe(2);
    expect(await service.checkDue(new Date(NOW.getTime() + 3_600_000))).toBe(0);
    expect(await service.checkDue(new Date(NOW.getTime() + 21 * 3_600_000))).toBe(2);
    expect((await row(a.business.id)).domainCheck).toBe('ok');
    expect((await row(b.business.id)).domainCheck).toBe('ok');
  });

  it('changing the website address forgets the old domain', async () => {
    const o = await withSite();
    provider.set('shiran.co.il', { status: 'ok', expiresAt: inDays(5) });
    await service.check(o.business.id, NOW);
    const res = await req(ctx.app, 'PATCH', apiPaths.businesses.detail(o.business.id), o.token, {
      websiteUrl: 'https://another.com',
    });
    expect(res.statusCode).toBe(200);
    expect(await row(o.business.id)).toMatchObject({
      domainCheck: null,
      domainExpiresAt: null,
      domainCheckedAt: null,
      domainRemindedDays: null,
    });
  });

  it('opening the screen starts the lookup by itself: the date appears with nothing to press', async () => {
    const o = await withSite();
    const id = o.business.id;
    provider.set('shiran.co.il', { status: 'ok', expiresAt: inDays(40) });
    const get = async () => (await req(ctx.app, 'GET', apiPaths.domain.domain(id), o.token)).json();

    const first = await get();
    // Not looked up yet: it says it is checking (a quick registry may even have answered already).
    expect(first.domain).toBe('shiran.co.il');
    expect(first.check === null ? first.checking : first.check === 'ok').toBe(true);
    // Moments later (the screen asks again): the date, and no new question to the registry.
    let later = first;
    for (let i = 0; i < 40 && later.check === null; i++) {
      await new Promise((r) => setTimeout(r, 25));
      later = await get();
    }
    expect(later).toMatchObject({ check: 'ok', checking: false });
    expect(later.daysLeft).toBeGreaterThan(30);
    await get();
    expect(provider.asked).toEqual(['shiran.co.il']);
  });

  it('opening it again later asks again only when the answer is a day old, or failed a while ago', async () => {
    const o = await withSite();
    const id = o.business.id;
    const ctxOf = { businessId: id } as never;
    provider.set('shiran.co.il', { status: 'failed' });
    await service.statusAndRefresh(ctxOf, NOW);
    for (let i = 0; i < 40 && (await row(id)).domainCheck === null; i++) {
      await new Promise((r) => setTimeout(r, 25));
    }
    expect((await row(id)).domainCheck).toBe('failed');
    const asked = () => provider.asked.length;
    expect(asked()).toBe(1);

    const settle = () => new Promise((r) => setTimeout(r, 150));
    // Five minutes later: too soon to try a failure again.
    await service.statusAndRefresh(ctxOf, new Date(NOW.getTime() + 5 * 60_000));
    await settle();
    expect(asked()).toBe(1);
    // Fifteen minutes later: again, and this time it answers; then a day passes.
    provider.set('shiran.co.il', { status: 'ok', expiresAt: inDays(300) });
    await service.statusAndRefresh(ctxOf, new Date(NOW.getTime() + 15 * 60_000));
    await settle();
    expect(asked()).toBe(2);
    await service.statusAndRefresh(ctxOf, new Date(NOW.getTime() + 3 * 3_600_000));
    await settle();
    expect(asked()).toBe(2);
    await service.statusAndRefresh(ctxOf, new Date(NOW.getTime() + 25 * 3_600_000));
    await settle();
    expect(asked()).toBe(3);
  });

  it('a business without a website asks nothing', async () => {
    const o = await withSite(null);
    const res = await req(ctx.app, 'GET', apiPaths.domain.domain(o.business.id), o.token);
    expect(res.json()).toMatchObject({ domain: null, check: null, checking: false });
    expect(provider.asked).toHaveLength(0);
  });

  it('anyone in the business sees it, only the owner looks it up now, outsiders get nothing', async () => {
    const o = await withSite();
    const id = o.business.id;
    const employee = await newUser(ctx.app, 'emp');
    await addMember(ctx.prisma, id, employee.userId, 'EMPLOYEE');
    const stranger = await newUser(ctx.app, 'str');
    provider.set('shiran.co.il', { status: 'ok', expiresAt: inDays(40) });

    const before = await req(ctx.app, 'GET', apiPaths.domain.domain(id), employee.token);
    expect(before.statusCode).toBe(200);
    expect(before.json()).toMatchObject({ domain: 'shiran.co.il' });

    expect(
      (await req(ctx.app, 'POST', apiPaths.domain.domain(id), employee.token)).statusCode,
    ).toBe(403);
    expect((await req(ctx.app, 'GET', apiPaths.domain.domain(id), stranger.token)).statusCode).toBe(
      404,
    );

    const now = await req(ctx.app, 'POST', apiPaths.domain.domain(id), o.token);
    expect(now.statusCode).toBe(200);
    expect(now.json()).toMatchObject({ domain: 'shiran.co.il', check: 'ok' });
    expect(now.json().daysLeft).toBeGreaterThan(30);
    // Pressing it again straight away doesn't ask the registry again.
    await req(ctx.app, 'POST', apiPaths.domain.domain(id), o.token);
    expect(provider.asked.length).toBeLessThanOrEqual(2);
    expect(
      (await req(ctx.app, 'GET', apiPaths.domain.domain(id), employee.token)).json().check,
    ).toBe('ok');
  });
});
