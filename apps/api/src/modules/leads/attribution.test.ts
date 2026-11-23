import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { apiPaths, LEAD_FORM_PATH } from '@simplecatch/shared';
import { Writable } from 'node:stream';
import { createTestApp, resetDb, testConfig } from '../../../test/helpers';
import { addMember, newUser, ownerWithBusiness, req } from '../../../test/business-helpers';
import { createFormToken } from '../../lib/form-token';
import { buildPublicApp } from '../../public/app';
import { MemoryWhatsAppSender, signWebhookBody } from '../../integrations/whatsapp';
import { MemoryEmailSender } from '../../integrations/email';
import { buildApp } from '../../app';

const sp = apiPaths.site;
const lp = apiPaths.leads;

describe('where website leads come from (F26)', () => {
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
    logs.length = 0;
  });

  const host = (sub: string) => `${sub}.${ctx.app.config.PUBLIC_SITE_HOST}`;

  async function liveSite(sub: string) {
    const o = await ownerWithBusiness(ctx.app, sub);
    const id = o.business.id;
    const site = (
      await req(ctx.app, 'POST', sp.site(id), o.token, { templateKey: 'beauty' })
    ).json().site;
    await req(ctx.app, 'PUT', sp.subdomain(id), o.token, { subdomain: sub });
    await req(ctx.app, 'POST', sp.publish(id), o.token, { revision: 0 });
    const contactId = site.sections.find((s: { type: string }) => s.type === 'contact').id;
    return { ...o, id, contactId };
  }

  /** A page view; returns the cookie the site set, if any. */
  const view = async (sub: string, url: string, cookie?: string, referer?: string) => {
    const res = await pub.inject({
      method: 'GET',
      url,
      headers: {
        host: host(sub),
        ...(cookie ? { cookie } : {}),
        ...(referer ? { referer } : {}),
      },
    });
    expect(res.statusCode).toBe(200);
    const set = res.headers['set-cookie'];
    return typeof set === 'string' ? set : undefined;
  };
  const pair = (setCookie: string | undefined) => setCookie?.split(';')[0];

  const submit = (sub: string, contactId: string, phone: string, cookie?: string) =>
    pub.inject({
      method: 'POST',
      url: LEAD_FORM_PATH,
      headers: {
        host: host(sub),
        'content-type': 'application/x-www-form-urlencoded',
        ...(cookie ? { cookie } : {}),
      },
      payload: new URLSearchParams({
        _t: createFormToken(ctx.app.config.FORM_TOKEN_SECRET, sub, Date.now() - 10_000),
        _s: contactId,
        website: '',
        name: 'דנה כהן',
        phone,
        consent: 'on',
      }).toString(),
    });

  it('an ad click is kept until the form; a later ad replaces it, a plain visit does not', async () => {
    const o = await liveSite('attr-salon');
    const set = await view(
      'attr-salon',
      '/?gclid=SECRET-CLICK&utm_campaign=summer&utm_term=hairdresser',
    );
    expect(set).toMatch(/^lf_src=[\w-]+; Max-Age=2592000; Path=\/; HttpOnly; SameSite=Lax$/);
    let cookie = pair(set)!;
    // A later visit from Google search keeps the ad; the form sent with that cookie.
    expect(await view('attr-salon', '/', cookie, 'https://www.google.com/')).toBeUndefined();
    await submit('attr-salon', o.contactId, '052-7654321', cookie);

    // A Facebook ad click replaces it.
    cookie = pair(await view('attr-salon', '/?utm_source=facebook&utm_medium=paid', cookie))!;
    await submit('attr-salon', o.contactId, '052-7654322', cookie);

    const leads = (await req(ctx.app, 'GET', lp.list(o.id), o.token)).json().leads;
    expect(leads.map((l: { attribution: { source: string } }) => l.attribution.source)).toEqual([
      'meta_ads',
      'google_ads',
    ]);
    expect(leads[1].attribution).toMatchObject({
      campaign: 'summer',
      term: 'hairdresser',
      landingPath: '/',
      clickIdType: 'gclid',
    });
    // The click id's value is never stored or logged.
    const stored = await ctx.prisma.lead.findMany({ select: { attribution: true } });
    expect(JSON.stringify(stored)).not.toContain('SECRET-CLICK');
    expect(logs.join('')).not.toContain('SECRET-CLICK');
  });

  it('organic, another site and direct; a tampered cookie reads as direct; old leads are unknown', async () => {
    const o = await liveSite('attr-cafe');
    const google = pair(await view('attr-cafe', '/', undefined, 'https://www.google.co.il/'));
    await submit('attr-cafe', o.contactId, '052-1111111', google);
    const other = pair(await view('attr-cafe', '/', undefined, 'https://blog.example.org/x'));
    await submit('attr-cafe', o.contactId, '052-2222222', other);
    expect(await view('attr-cafe', '/')).toBeUndefined();
    await submit('attr-cafe', o.contactId, '052-3333333');
    await submit('attr-cafe', o.contactId, '052-4444444', 'lf_src=not-json');
    // A lead from before F26.
    await ctx.prisma.lead.updateMany({
      where: { contact: { phone: '+972524444444' } },
      data: { attribution: undefined },
    });
    const first = await ctx.prisma.lead.findFirstOrThrow({
      where: { contact: { phone: '+972524444444' } },
    });
    await ctx.prisma.lead.update({
      where: { id: first.id },
      data: { attribution: null as never, attributionSource: null },
    });

    const leads = (await req(ctx.app, 'GET', lp.list(o.id), o.token)).json().leads;
    expect(
      leads.map(
        (l: { attribution: { source: string; referrerHost?: string } | null }) =>
          l.attribution?.source ?? null,
      ),
    ).toEqual([null, null, 'referral', 'google']);
    expect(leads[2].attribution.referrerHost).toBe('blog.example.org');

    // Filters: by source, and "unknown".
    const only = (q: string) =>
      req(ctx.app, 'GET', `${lp.list(o.id)}?${q}`, o.token).then((r) => r.json().leads.length);
    expect(await only('from=google')).toBe(1);
    expect(await only('from=unknown')).toBe(2);
  });

  it('reports leads, customers, value and close rate per source and campaign', async () => {
    const o = await liveSite('attr-shop');
    const ad = pair(await view('attr-shop', '/?gclid=a&utm_campaign=summer'));
    await submit('attr-shop', o.contactId, '052-1111111', ad);
    await submit('attr-shop', o.contactId, '052-2222222', ad);
    await submit('attr-shop', o.contactId, '052-3333333');
    const stages = (await req(ctx.app, 'GET', lp.pipeline(o.id), o.token)).json().stages;
    const won = stages.find((s: { kind: string }) => s.kind === 'WON').id;
    const lost = stages.find((s: { kind: string }) => s.kind === 'LOST').id;
    const leads = (await req(ctx.app, 'GET', `${lp.list(o.id)}?from=google_ads`, o.token)).json()
      .leads;
    await req(ctx.app, 'PATCH', lp.detail(o.id, leads[0].id), o.token, {
      stageId: won,
      expectedValue: 1200,
    });
    await req(ctx.app, 'PATCH', lp.detail(o.id, leads[1].id), o.token, { stageId: lost });

    const report = (
      await req(ctx.app, 'GET', `${apiPaths.reports.summary(o.id)}?days=30`, o.token)
    ).json();
    // Visits have their own test below.
    const noVisits = <T extends { visits: number }>(rows: T[]) =>
      rows.map(({ visits: _v, ...r }) => r);
    expect(noVisits(report.byAttribution)).toEqual([
      { source: 'google_ads', name: null, leads: 2, won: 1, lost: 1, wonValue: 1200 },
      { source: 'unknown', name: null, leads: 1, won: 0, lost: 0, wonValue: 0 },
    ]);
    expect(noVisits(report.byCampaign)).toEqual([
      {
        source: 'google_ads',
        name: null,
        campaign: 'summer',
        leads: 2,
        won: 1,
        lost: 1,
        wonValue: 1200,
      },
    ]);
    expect(await only(o, 'campaign=summer')).toBe(2);

    // Another business sees none of it.
    const other = await ownerWithBusiness(ctx.app, 'attr-other');
    expect(
      (await req(ctx.app, 'GET', `${lp.list(o.id)}?from=google_ads`, other.token)).statusCode,
    ).toBe(404);
  });

  const only = (o: { id: string; token: string }, q: string) =>
    req(ctx.app, 'GET', `${lp.list(o.id)}?${q}`, o.token).then((r) => r.json().leads.length);
  it('counts visits to a SimpleCatch site once per entry, not for bots or its own pages (F31)', async () => {
    const o = await liveSite('visit-salon');
    const UA =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1';
    const get = (url: string, headers: Record<string, string> = {}) =>
      pub.inject({ method: 'GET', url, headers: { host: host('visit-salon'), ...headers } });
    await get('/?gclid=SECRET-CLICK&utm_campaign=summer', { 'user-agent': UA });
    // A move between the site's own pages, a bot and a prefetch are not visits.
    await get('/', { 'user-agent': UA, referer: `https://${host('visit-salon')}/?gclid=x` });
    await get('/', { 'user-agent': 'Googlebot/2.1' });
    await get('/', { 'user-agent': UA, purpose: 'prefetch' });
    // Another site sending someone, and a direct visit.
    await get('/', { 'user-agent': UA, referer: 'https://www.google.co.il/' });
    await get('/', { 'user-agent': UA });
    // Give the background writes a moment.
    await new Promise((r) => setTimeout(r, 200));
    const rows = await ctx.prisma.visitCount.findMany({ orderBy: { source: 'asc' } });
    expect(rows.map((r) => [r.source, r.campaign, r.count])).toEqual([
      ['direct', '', 1],
      ['google', '', 1],
      ['google_ads', 'summer', 1],
    ]);
    expect(JSON.stringify(rows)).not.toContain('SECRET-CLICK');
    const rep = (
      await req(ctx.app, 'GET', `${apiPaths.reports.summary(o.id)}?days=7`, o.token)
    ).json();
    expect(rep.visits).toBe(3);
    // F32: the server sees every page view, so pages, entry pages and devices need no script.
    expect(rep.behavior).toMatchObject({
      pageViews: 4, // the three entries and the move between the site's own pages
      topPages: [{ path: '/', views: 4 }],
      landing: [{ path: '/', visits: 3, leads: 0 }],
      devices: { mobile: 3, tablet: 0, desktop: 0 },
      clicks: { phone: 0, whatsapp: 0, email: 0 },
    });
  });
  it("SimpleCatch's own sites carry one first-party script that reports taps, scroll and sections (F32, D-192)", async () => {
    const o = await liveSite('sec-salon');
    const UA =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1';
    const page = await pub.inject({
      method: 'GET',
      url: '/',
      headers: { host: host('sec-salon'), 'user-agent': UA },
    });
    expect(page.body).toContain('<script defer src="/__sc.js"></script></body>');
    expect(page.headers['content-security-policy']).toContain("script-src 'self'");
    expect(page.headers['content-security-policy']).toContain("connect-src 'self'");
    expect(page.headers['content-security-policy']).toContain("default-src 'none'");

    const js = await pub.inject({
      method: 'GET',
      url: '/__sc.js',
      headers: { host: host('sec-salon') },
    });
    expect(js.statusCode).toBe(200);
    expect(js.headers['content-type']).toContain('application/javascript');
    expect(() => new Function(js.body)).not.toThrow();

    const site = (await req(ctx.app, 'GET', sp.site(o.id), o.token)).json().site;
    const sections = site.sections as { id: string; type: string }[];
    const services = sections.find((x) => x.type === 'services')!;
    const contact = sections.find((x) => x.type === 'contact')!;
    const report = (e: unknown, ua = UA) =>
      pub.inject({
        method: 'POST',
        url: '/__sc',
        headers: { host: host('sec-salon'), 'content-type': 'text/plain', 'user-agent': ua },
        payload: JSON.stringify(e),
      });
    const ok = await report({
      p: '/',
      ev: [
        { k: 'click', l: 'phone' },
        { k: 'scroll', l: '50' },
        { k: 'form', l: 'start' },
        { k: 'device', l: 'toaster' }, // not an allowed kind from this script: the batch is dropped
      ],
    });
    expect(ok.statusCode).toBe(204);
    await report({
      p: '/',
      ev: [
        { k: 'click', l: 'phone' },
        { k: 'scroll', l: '50' },
        { k: 'form', l: 'start' },
      ],
      sec: [`s-${services.id}`, `s-${contact.id}`, 's-not-a-section', `s-${services.id}`],
    });
    // A tap inside a section (with a contact tap in the same request), and one inside an unknown id.
    await report({ p: '/', ev: [{ k: 'click', l: 'phone' }], clk: `s-${services.id}` });
    await report({ p: '/', ev: [], clk: 's-not-a-section' });
    await report(
      { p: '/', ev: [], sec: [`s-${services.id}`], clk: `s-${contact.id}` },
      'Googlebot/2.1',
    );
    await report('not json');
    await new Promise((r) => setTimeout(r, 100));

    const rep = (
      await req(ctx.app, 'GET', `${apiPaths.reports.summary(o.id)}?days=7`, o.token)
    ).json();
    expect(rep.behavior.clicks.phone).toBe(2);
    expect(rep.behavior.scroll.p50).toBe(1);
    expect(rep.behavior.formStarts).toBe(1);
    // Every section of the site is listed, in page order, even those nobody saw yet.
    const names = (rep.behavior.sections as { path: string; name: string }[]).map((x) => x.name);
    expect(names).toEqual(sections.map((x) => x.type));
    const row = (id: string) =>
      rep.behavior.sections[sections.findIndex((x) => x.id === id)] as {
        views: number;
        clicks: number;
        pageViews: number;
      };
    expect(row(services.id)).toMatchObject({ views: 1, clicks: 1 });
    expect(row(contact.id)).toMatchObject({ views: 1, clicks: 0 });
    expect(row(sections[0]!.id)).toMatchObject({ views: 0, clicks: 0 });
    expect(row(services.id).pageViews).toBeGreaterThan(0);
  });
});

describe('WhatsApp leads from Meta ads (F26)', () => {
  const BUSINESS_ID = '44444444-5555-4666-8777-888888888888';
  const SECRET = 'test-app-secret-0123456789';
  const PHONE_ID = '2234567890';
  let ctx: Awaited<ReturnType<typeof createTestApp>>;

  beforeAll(async () => {
    const config = testConfig({
      WHATSAPP_BUSINESS_ID: BUSINESS_ID,
      WHATSAPP_PHONE_NUMBER_ID: PHONE_ID,
      WHATSAPP_APP_SECRET: SECRET,
      WHATSAPP_VERIFY_TOKEN: 'verify-me-please',
    });
    const base = await createTestApp({ config });
    await base.app.close();
    const app = await buildApp({
      config,
      prisma: base.prisma,
      emailSender: new MemoryEmailSender(),
      whatsappSender: new MemoryWhatsAppSender(),
    });
    await app.ready();
    ctx = {
      ...base,
      app,
      close: async () => {
        await app.close();
        await base.prisma.$disconnect();
      },
    };
  });
  afterAll(() => ctx.close());
  beforeEach(() => resetDb(ctx.prisma));

  it('a Click-to-WhatsApp ad reaches the lead when the sender becomes a customer', async () => {
    const owner = await newUser(ctx.app, 'ctwa-owner');
    await ctx.prisma.business.create({
      data: {
        id: BUSINESS_ID,
        name: 'מספרה',
        industry: 'beauty',
        status: 'ACTIVE',
        whatsappReplyMode: 'off',
      },
    });
    await addMember(ctx.prisma, BUSINESS_ID, owner.userId, 'OWNER');
    const raw = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: PHONE_ID },
                contacts: [{ wa_id: '972501112233', profile: { name: 'נועה' } }],
                messages: [
                  {
                    from: '972501112233',
                    id: `wamid.ctwa-${Date.now()}`,
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    type: 'text',
                    text: { body: 'היי, ראיתי את המודעה' },
                    referral: {
                      source_type: 'ad',
                      source_id: '120200',
                      headline: 'תספורת ב-20% הנחה',
                      ctwa_clid: 'ARsecret',
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    const res = await ctx.app.inject({
      method: 'POST',
      url: apiPaths.whatsapp.webhook,
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': signWebhookBody(raw, SECRET),
      },
      payload: raw,
    });
    expect(res.statusCode).toBe(200);
    const number = await ctx.prisma.whatsAppNumber.findFirstOrThrow();
    await req(ctx.app, 'POST', apiPaths.whatsapp.classify(BUSINESS_ID, number.id), owner.token, {
      as: 'BUSINESS',
    });
    const [lead] = (await req(ctx.app, 'GET', lp.list(BUSINESS_ID), owner.token)).json().leads;
    expect(lead.source).toBe('whatsapp');
    expect(lead.attribution).toMatchObject({
      source: 'meta_ads',
      adId: '120200',
      adHeadline: 'תספורת ב-20% הנחה',
      clickIdType: 'ctwa',
    });
    expect(JSON.stringify(lead)).not.toContain('ARsecret');
  });
});
