import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { apiPaths, LEAD_FORM_PATH } from '@leadflow/shared';
import { Writable } from 'node:stream';
import { createTestApp, resetDb, testConfig } from '../../../test/helpers';
import { addMember, newUser, ownerWithBusiness, req } from '../../../test/business-helpers';
import { createFormToken } from '../../lib/form-token';
import { buildPublicApp } from '../../public/app';

const sp = apiPaths.site;

describe('website lead form (F07)', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let pub: Awaited<ReturnType<typeof buildPublicApp>>;
  const logs: string[] = [];

  beforeAll(async () => {
    ctx = await createTestApp({ config: testConfig({ LEAD_FORM_RATE_LIMIT_MAX: '1000' }) });
    pub = await buildPublicApp({
      config: ctx.app.config,
      prisma: ctx.prisma,
      cache: ctx.app.siteCache,
      email: ctx.email,
      logStream: new Writable({
        write(chunk, _enc, cb) {
          logs.push(String(chunk));
          cb();
        },
      }),
    });
  });
  afterAll(async () => {
    await pub.close();
    await ctx.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    ctx.email.clear();
    logs.length = 0;
  });

  const host = (sub: string) => `${sub}.${ctx.app.config.PUBLIC_SITE_HOST}`;
  /** A token issued `ageMs` ago (default: long enough to pass the minimum fill time). */
  const token = (sub: string, ageMs = 10_000) =>
    createFormToken(ctx.app.config.FORM_TOKEN_SECRET, sub, Date.now() - ageMs);

  async function liveSite(
    sub = 'salon',
    configure?: (sections: Array<{ type: string; form?: { enabled: boolean } }>) => void,
  ) {
    const o = await ownerWithBusiness(ctx.app);
    const id = o.business.id;
    await req(ctx.app, 'PATCH', apiPaths.businesses.detail(id), o.token, { phone: '050-1111111' });
    const site = (
      await req(ctx.app, 'POST', sp.site(id), o.token, { templateKey: 'beauty' })
    ).json().site;
    let revision = 0;
    if (configure) {
      const sections = structuredClone(site.sections);
      configure(sections);
      const saved = await req(ctx.app, 'PUT', sp.draft(id), o.token, {
        ...site,
        revision: 0,
        sections,
      });
      revision = saved.json().site.revision;
    }
    await req(ctx.app, 'PUT', sp.subdomain(id), o.token, { subdomain: sub });
    await req(ctx.app, 'POST', sp.publish(id), o.token, { revision });
    const contactId = site.sections.find((s: { type: string }) => s.type === 'contact').id;
    return { ...o, id, contactId };
  }

  const submit = (sub: string, fields: Record<string, string>) =>
    pub.inject({
      method: 'POST',
      url: LEAD_FORM_PATH,
      headers: { host: host(sub), 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams(fields).toString(),
    });

  const valid = (contactId: string, sub = 'salon', overrides: Record<string, string> = {}) => ({
    _t: token(sub),
    _s: contactId,
    website: '',
    name: 'דנה כהן',
    phone: '052-7654321',
    email: 'dana@example.com',
    message: 'אשמח לתור ליום חמישי',
    consent: 'on',
    ...overrides,
  });

  it('the published page carries a real form with a fresh token', async () => {
    await liveSite();
    const page = await pub.inject({ method: 'GET', url: '/', headers: { host: host('salon') } });
    expect(page.body).toContain(`action="${LEAD_FORM_PATH}"`);
    expect(page.body).toMatch(/name="_t" value="\d{13}\./);
  });

  it('creates contact + lead + activity, thanks the visitor, and emails owner and manager only (AC-04)', async () => {
    const o = await liveSite();
    const manager = await newUser(ctx.app, 'mgr');
    const employee = await newUser(ctx.app, 'emp');
    await addMember(ctx.prisma, o.id, manager.userId, 'MANAGER');
    await addMember(ctx.prisma, o.id, employee.userId, 'EMPLOYEE');
    ctx.email.clear(); // drop the sign-up verification emails

    const res = await submit('salon', valid(o.contactId));
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('תודה!');
    expect(res.body).toContain('קיבלנו את הפרטים');

    const leads = await ctx.prisma.lead.findMany({ include: { contact: true, stage: true } });
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({
      businessId: o.id,
      source: 'website_form',
      sourceUrl: `http://${host('salon')}/`,
      message: 'אשמח לתור ליום חמישי',
      contact: { name: 'דנה כהן', phone: '+972527654321', email: 'dana@example.com' },
      stage: { name: 'חדש', position: 0 },
    });
    expect(await ctx.prisma.pipelineStage.count({ where: { businessId: o.id } })).toBe(6);
    expect(await ctx.prisma.activity.count({ where: { type: 'lead.created' } })).toBe(1);
    expect(
      await ctx.prisma.auditLog.count({ where: { action: 'lead.created', businessId: o.id } }),
    ).toBe(1);

    await expect.poll(() => ctx.email.sent.length).toBe(2);
    const recipients = ctx.email.sent.map((m) => m.to).sort();
    expect(recipients).not.toContain(expect.stringContaining('emp-'));
    expect(ctx.email.sent[0]!.subject).toBe('פנייה חדשה מהאתר — מספרת שירן');
    expect(ctx.email.sent[0]!.text).toContain('052-7654321');
    expect(ctx.email.sent[0]!.text).toContain(`/b/${o.id}/leads`);
    expect(ctx.email.sent[0]!.text).toContain(`/b/${o.id}/account`);
  });

  it('a member who turned new-lead emails off gets none; the others still do', async () => {
    const o = await liveSite();
    const manager = await newUser(ctx.app, 'mgr');
    await addMember(ctx.prisma, o.id, manager.userId, 'MANAGER');
    const prefsPath = apiPaths.businesses.notifications(o.id);
    expect((await req(ctx.app, 'GET', prefsPath, manager.token)).json()).toEqual({
      prefs: { newLeadEmail: true },
    });
    const off = await req(ctx.app, 'PUT', prefsPath, manager.token, { newLeadEmail: false });
    expect(off.json()).toEqual({ prefs: { newLeadEmail: false } });
    // Only the caller's own membership changed.
    expect(
      (await ctx.prisma.membership.findMany({ where: { notifyNewLeads: false } })).map(
        (m) => m.userId,
      ),
    ).toEqual([manager.userId]);
    ctx.email.clear();

    await submit('salon', valid(o.contactId));
    await expect.poll(() => ctx.email.sent.length).toBe(1);
    expect(ctx.email.sent[0]!.to).not.toContain('mgr');
  });

  it('a double submit (same token) creates one lead; a returning phone reuses the contact', async () => {
    const o = await liveSite();
    const fields = valid(o.contactId);
    await submit('salon', fields);
    await submit('salon', fields);
    expect(await ctx.prisma.lead.count()).toBe(1);

    await submit('salon', valid(o.contactId, 'salon', { name: 'דנה', message: 'שוב אני' }));
    expect(await ctx.prisma.lead.count()).toBe(2);
    expect(await ctx.prisma.contact.count()).toBe(1);
  });

  it('drops bots quietly: honeypot filled or submitted too fast → thank-you page, nothing stored', async () => {
    const o = await liveSite();
    const honeypot = await submit('salon', valid(o.contactId, 'salon', { website: 'http://spam' }));
    const fast = await submit('salon', valid(o.contactId, 'salon', { _t: token('salon', 500) }));
    for (const res of [honeypot, fast]) {
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('תודה!');
    }
    expect(await ctx.prisma.lead.count()).toBe(0);
  });

  it('rejects missing/expired/foreign tokens with a "refresh" page', async () => {
    const o = await liveSite();
    for (const t of ['__LF_FORM_TOKEN__', token('salon', 25 * 3600_000), token('other-site')]) {
      const res = await submit('salon', valid(o.contactId, 'salon', { _t: t }));
      expect(res.statusCode).toBe(400);
      expect(res.body).toContain('רעננו את הדף');
    }
    expect(await ctx.prisma.lead.count()).toBe(0);
  });

  it('lists Hebrew validation errors (consent, phone) in the site look', async () => {
    const o = await liveSite();
    const res = await submit('salon', valid(o.contactId, 'salon', { phone: '123', consent: '' }));
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('יש לאשר את יצירת הקשר כדי לשלוח');
    expect(res.body).toContain('מספר הטלפון אינו תקין');
    expect(res.body).toContain('noindex');
  });

  it('404 for unpublished sites, unknown hosts, disabled forms and unknown sections', async () => {
    const o = await liveSite('salon', (sections) => {
      sections.find((s) => s.type === 'contact')!.form!.enabled = false;
    });
    expect((await submit('salon', valid(o.contactId))).statusCode).toBe(404);
    expect((await submit('nobody', valid(o.contactId, 'nobody'))).statusCode).toBe(404);
    const live = await liveSite('salon2');
    expect((await submit('salon2', valid('not-a-section', 'salon2'))).statusCode).toBe(404);
    await req(ctx.app, 'POST', sp.unpublish(live.id), live.token);
    expect((await submit('salon2', valid(live.contactId, 'salon2'))).statusCode).toBe(404);
    expect(await ctx.prisma.lead.count()).toBe(0);
  });

  it("never logs the visitor's personal details", async () => {
    const o = await liveSite();
    await submit('salon', valid(o.contactId));
    const all = logs.join('\n');
    expect(all).toContain('lead created from website');
    for (const pii of ['דנה', '7654321', 'dana@example.com', 'יום חמישי'])
      expect(all).not.toContain(pii);
  });

  it('rate-limits submissions per visitor and site', async () => {
    const strict = await createTestApp({ config: testConfig({ LEAD_FORM_RATE_LIMIT_MAX: '2' }) });
    const strictPub = await buildPublicApp({
      config: strict.app.config,
      prisma: strict.prisma,
      email: strict.email,
    });
    try {
      const o = await liveSite();
      const send = () =>
        strictPub.inject({
          method: 'POST',
          url: LEAD_FORM_PATH,
          headers: { host: host('salon'), 'content-type': 'application/x-www-form-urlencoded' },
          payload: new URLSearchParams({
            ...valid(o.contactId),
            _t: createFormToken(strict.app.config.FORM_TOKEN_SECRET, 'salon', Date.now() - 10_000),
          }).toString(),
        });
      expect((await send()).statusCode).toBe(200);
      expect((await send()).statusCode).toBe(200);
      const third = await send();
      expect(third.statusCode).toBe(429);
      expect(third.body).toContain('יותר מדי ניסיונות');
    } finally {
      await strictPub.close();
      await strict.close();
    }
  });
});

describe('leads list API', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());
  beforeEach(() => resetDb(ctx.prisma));

  it('owners and managers see all leads newest first; employees only their assigned ones', async () => {
    const o = await ownerWithBusiness(ctx.app);
    const emp = await newUser(ctx.app, 'emp');
    await addMember(ctx.prisma, o.business.id, emp.userId, 'EMPLOYEE');
    const stage = await ctx.prisma.pipelineStage.create({
      data: { businessId: o.business.id, name: 'חדש', position: 0 },
    });
    const contact = await ctx.prisma.contact.create({
      data: { businessId: o.business.id, name: 'רון', phone: '+972501112233' },
    });
    for (const [i, ownerId] of [null, emp.userId].entries()) {
      await ctx.prisma.lead.create({
        data: {
          businessId: o.business.id,
          contactId: contact.id,
          stageId: stage.id,
          source: 'website_form',
          ownerId,
          createdAt: new Date(Date.now() + i * 1000),
        },
      });
    }
    const all = await req(ctx.app, 'GET', apiPaths.leads.list(o.business.id), o.token);
    expect(all.json().leads).toHaveLength(2);
    expect(all.json().leads[0]).toMatchObject({ contact: { name: 'רון' }, stage: { name: 'חדש' } });
    const mine = await req(ctx.app, 'GET', apiPaths.leads.list(o.business.id), emp.token);
    expect(mine.json().leads).toHaveLength(1);
  });
});
