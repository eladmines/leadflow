import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { apiPaths } from '@simplecatch/shared';
import { EMBED_SCRIPT } from './script';
import { createTestApp, resetDb, testConfig } from '../../../test/helpers';
import { newUser, ownerWithBusiness, req } from '../../../test/business-helpers';

const ep = apiPaths.embed;

describe('leads from a website built elsewhere (F30)', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;

  beforeAll(async () => {
    ctx = await createTestApp({ config: testConfig({ LEAD_FORM_RATE_LIMIT_MAX: '1000' }) });
  });
  afterAll(async () => ctx.close());
  beforeEach(async () => resetDb(ctx.prisma));

  const keyOf = async (o: Awaited<ReturnType<typeof ownerWithBusiness>>) =>
    (await req(ctx.app, 'GET', ep.info(o.business.id), o.token)).json();

  /** What the script sends: JSON in a text/plain body, from another origin. */
  const post = (body: Record<string, unknown>) =>
    ctx.app.inject({
      method: 'POST',
      url: ep.lead,
      headers: { 'content-type': 'text/plain', origin: 'https://my-wix-site.example' },
      payload: JSON.stringify(body),
    });
  const base = (key: string, extra: Record<string, unknown> = {}) => ({
    key,
    id: 'a1b2c3d4e5f6g7h8i9j0',
    name: 'דנה כהן',
    phone: '052-7654321',
    consent: 'on',
    page: 'https://www.my-site.example/contact?x=1',
    ...extra,
  });

  it('gives the owner the script tag with a stable key', async () => {
    const o = await ownerWithBusiness(ctx.app, 'embed-a');
    const info = await keyOf(o);
    expect(info.snippet).toBe(
      `<script async src="${info.scriptUrl}" data-key="${info.key}"></script>`,
    );
    expect(info.scriptUrl.endsWith(ep.script)).toBe(true);
    expect((await keyOf(o)).key).toBe(info.key);
  });

  it('only the owner gets it; outsiders get nothing', async () => {
    const o = await ownerWithBusiness(ctx.app, 'embed-b');
    const stranger = await newUser(ctx.app, 'stranger');
    const res = await req(ctx.app, 'GET', ep.info(o.business.id), stranger.token);
    expect(res.statusCode).toBe(404);
  });

  it('serves the script to other sites', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: ep.script });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/javascript');
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.body).toContain('form[data-simplecatch]');
  });

  it('ships a script that parses', () => {
    expect(() => new Function(EMBED_SCRIPT)).not.toThrow();
  });

  it('saves the lead with its ad, once, and never the click id', async () => {
    const o = await ownerWithBusiness(ctx.app, 'embed-c');
    const { key } = await keyOf(o);
    const body = base(key, {
      params: { gclid: 'SECRET-CLICK', utm_campaign: 'summer', utm_term: 'hairdresser', junk: 'x' },
      landing: 'https://www.my-site.example/sale?gclid=SECRET-CLICK',
    });
    const first = await post(body);
    expect(first.statusCode).toBe(200);
    expect(first.headers['access-control-allow-origin']).toBe('*');
    expect(first.json()).toEqual({ ok: true });
    // A double click: the same id.
    expect((await post(body)).json()).toEqual({ ok: true });

    const leads = await ctx.prisma.lead.findMany({
      where: { businessId: o.business.id },
      include: { contact: true },
    });
    expect(leads).toHaveLength(1);
    expect(leads[0]!.source).toBe('website_form');
    expect(leads[0]!.sourceUrl).toBe('https://www.my-site.example/contact');
    expect(leads[0]!.attributionSource).toBe('google_ads');
    expect(leads[0]!.attribution).toMatchObject({
      campaign: 'summer',
      term: 'hairdresser',
      clickIdType: 'gclid',
      landingPath: '/sale',
    });
    expect(JSON.stringify(leads[0]!.attribution)).not.toContain('SECRET-CLICK');
    expect(JSON.stringify(leads[0]!.attribution)).not.toContain('junk');
  });

  it('names organic, other-site and direct visits like a SimpleCatch site does', async () => {
    const o = await ownerWithBusiness(ctx.app, 'embed-d');
    const { key } = await keyOf(o);
    await post(
      base(key, {
        id: 'org0000000000000001',
        phone: '052-1111111',
        referrer: 'https://www.google.co.il/',
      }),
    );
    await post(
      base(key, {
        id: 'oth0000000000000001',
        phone: '052-2222222',
        referrer: 'https://blog.example.org/x',
      }),
    );
    await post(base(key, { id: 'dir0000000000000001', phone: '052-3333333' }));
    const by = async (phone: string) =>
      (await ctx.prisma.lead.findFirstOrThrow({ where: { contact: { phone } } })).attributionSource;
    expect(await by('+972521111111')).toBe('google');
    expect(await by('+972522222222')).toBe('referral');
    expect(await by('+972523333333')).toBe('direct');
  });

  it('rejects a wrong or another business key, and explains a missing phone', async () => {
    const a = await ownerWithBusiness(ctx.app, 'embed-e');
    const { key } = await keyOf(a);
    expect((await post(base(key.slice(0, -1) + (key.endsWith('A') ? 'B' : 'A')))).statusCode).toBe(
      400,
    );
    expect((await post(base('0'.repeat(32) + '.' + 'A'.repeat(22)))).statusCode).toBe(400);

    // A phone is the one thing a lead needs; it is explained in the business's language.
    const noPhone = await post(base(key, { phone: undefined }));
    expect(noPhone.statusCode).toBe(400);
    expect(noPhone.json().ok).toBe(false);
    expect(noPhone.json().errors?.length).toBeGreaterThan(0);
    expect(await ctx.prisma.lead.count()).toBe(0);
  });

  it("needs no consent field: sending a form on the owner's own site is asking to be contacted (D-197)", async () => {
    const o = await ownerWithBusiness(ctx.app, 'embed-g');
    const { key } = await keyOf(o);
    expect((await post(base(key, { consent: undefined }))).json()).toEqual({ ok: true });
    expect(await ctx.prisma.lead.count({ where: { businessId: o.business.id } })).toBe(1);
  });

  it('drops bots that fill the hidden field, and garbage bodies', async () => {
    const o = await ownerWithBusiness(ctx.app, 'embed-f');
    const { key } = await keyOf(o);
    expect((await post(base(key, { website: 'http://spam.example' }))).json()).toEqual({
      ok: true,
    });
    const junk = await ctx.app.inject({
      method: 'POST',
      url: ep.lead,
      headers: { 'content-type': 'text/plain' },
      payload: 'not json',
    });
    expect(junk.statusCode).toBe(400);
    expect(await ctx.prisma.lead.count()).toBe(0);
  });

  describe('visits (F31)', () => {
    const UA =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15';
    const visit = (body: Record<string, unknown>, ua: string | undefined = UA) =>
      ctx.app.inject({
        method: 'POST',
        url: ep.visit,
        headers: { 'content-type': 'text/plain', ...(ua ? { 'user-agent': ua } : {}) },
        payload: JSON.stringify(body),
      });
    const summary = async (o: Awaited<ReturnType<typeof ownerWithBusiness>>) =>
      (
        await req(ctx.app, 'GET', `${apiPaths.reports.summary(o.business.id)}?days=7`, o.token)
      ).json();

    it('counts visits per source and campaign, and shows them next to the leads', async () => {
      const o = await ownerWithBusiness(ctx.app, 'visit-a');
      const { key } = await keyOf(o);
      const ad = {
        key,
        params: { gclid: 'SECRET-CLICK', utm_campaign: 'summer' },
        page: 'https://www.my-site.example/',
      };
      for (let i = 0; i < 3; i++) expect((await visit(ad)).statusCode).toBe(200);
      await visit({ key, page: 'https://www.my-site.example/' });
      await visit({
        key,
        referrer: 'https://blog.example.org/post',
        page: 'https://www.my-site.example/',
      });
      // One of the three ad visitors left their details.
      await post(
        base(key, { params: { gclid: 'SECRET-CLICK', utm_campaign: 'summer' }, landing: ad.page }),
      );

      const rep = await summary(o);
      expect(rep.visits).toBe(5);
      const google = rep.byAttribution.find((r: { source: string }) => r.source === 'google_ads');
      expect(google).toMatchObject({ visits: 3, leads: 1 });
      expect(rep.byCampaign[0]).toMatchObject({ campaign: 'summer', visits: 3, leads: 1 });
      expect(
        rep.byAttribution.find((r: { source: string }) => r.source === 'unknown'),
      ).toMatchObject({
        visits: 1,
        leads: 0,
      });
      expect(
        rep.byAttribution.find((r: { name: string | null }) => r.name === 'blog.example.org'),
      ).toMatchObject({ source: 'referral', visits: 1 });
      expect(JSON.stringify(await ctx.prisma.visitCount.findMany())).not.toContain('SECRET-CLICK');
    });

    it('ignores bots, a wrong key and garbage; other businesses see none of it', async () => {
      const a = await ownerWithBusiness(ctx.app, 'visit-b');
      const b = await ownerWithBusiness(ctx.app, 'visit-c');
      const { key } = await keyOf(a);
      const body = { key, page: 'https://www.my-site.example/' };
      await visit(body, 'Googlebot/2.1 (+http://www.google.com/bot.html)');
      await visit(body, 'curl/8.4.0');
      expect(
        (await visit({ ...body, key: key.slice(0, -1) + (key.endsWith('A') ? 'B' : 'A') }))
          .statusCode,
      ).toBe(400);
      expect((await visit({ nonsense: true })).statusCode).toBe(400);
      expect(await ctx.prisma.visitCount.count()).toBe(0);
      await visit(body);
      expect((await summary(a)).visits).toBe(1);
      expect((await summary(b)).visits).toBe(0);
    });
  });

  describe('behavior (F32)', () => {
    const UA =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1';
    const events = (body: Record<string, unknown>, ua = UA) =>
      ctx.app.inject({
        method: 'POST',
        url: ep.event,
        headers: { 'content-type': 'text/plain', 'user-agent': ua },
        payload: JSON.stringify(body),
      });
    const behavior = async (o: Awaited<ReturnType<typeof ownerWithBusiness>>) =>
      (
        await req(ctx.app, 'GET', `${apiPaths.reports.summary(o.business.id)}?days=7`, o.token)
      ).json().behavior;

    it('counts pages, landing pages, devices, taps, scroll and form starts', async () => {
      const o = await ownerWithBusiness(ctx.app, 'beh-a');
      const { key } = await keyOf(o);
      const send = (evs: unknown[]) => events({ key, events: evs });
      // Three sessions: two start on /sale/ (one on a phone), one on the home page.
      await send([
        { k: 'page', l: '/sale/' },
        { k: 'landing', l: '/sale/' },
        { k: 'device', l: 'mobile' },
      ]);
      await send([
        { k: 'page', l: '/sale' },
        { k: 'landing', l: '/sale' },
        { k: 'device', l: 'desktop' },
      ]);
      await send([
        { k: 'page', l: '/' },
        { k: 'landing', l: '/' },
        { k: 'device', l: 'mobile' },
      ]);
      await send([{ k: 'page', l: '/sale?utm=x#top' }]);
      await send([
        { k: 'click', l: 'phone' },
        { k: 'click', l: 'whatsapp' },
        { k: 'form', l: 'start' },
      ]);
      await send([
        { k: 'scroll', l: '50' },
        { k: 'scroll', l: '90' },
      ]);
      await send([{ k: 'scroll', l: '50' }]);
      // One of the /sale visitors sent the form.
      await post(
        base(key, {
          landing: 'https://www.my-site.example/sale',
          params: { utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'summer' },
        }),
      );
      // And a direct visitor who landed on /sale/ and sent the form too.
      await post(
        base(key, {
          id: 'dir0000000000000002',
          phone: '052-9999999',
          landing: 'https://www.my-site.example/sale/',
        }),
      );

      const b = await behavior(o);
      expect(b.pageViews).toBe(4);
      expect(b.topPages).toEqual([
        { path: '/sale', views: 3 },
        { path: '/', views: 1 },
      ]);
      expect(b.landing).toEqual([
        { path: '/sale', visits: 2, leads: 2 },
        { path: '/', visits: 1, leads: 0 },
      ]);
      expect(b.devices).toEqual({ mobile: 2, tablet: 0, desktop: 1 });
      expect(b.clicks).toEqual({ phone: 1, whatsapp: 1, email: 0 });
      expect(b.scroll).toEqual({ p50: 2, p90: 1 });
      expect(b.formStarts).toBe(1);
    });

    it('counts the buttons an owner named, with a clean short name', async () => {
      const o = await ownerWithBusiness(ctx.app, 'beh-d');
      const { key } = await keyOf(o);
      await events({
        key,
        events: [
          { k: 'page', l: '/' },
          { k: 'cta', l: 'book-appointment' },
          { k: 'cta', l: 'book-appointment' },
          { k: 'cta', l: '  קבע\n\u0007  תור  ' },
          { k: 'cta', l: 'x'.repeat(100) },
          { k: 'cta', l: '   ' },
        ],
      });
      const b = await behavior(o);
      expect(b.ctas).toEqual(
        expect.arrayContaining([
          { name: 'book-appointment', count: 2 },
          { name: 'קבע תור', count: 1 },
          { name: 'x'.repeat(40), count: 1 },
        ]),
      );
      expect(b.ctas).toHaveLength(3);
    });

    it('counts sections seen per page, rebuilding a clean label from its parts', async () => {
      const o = await ownerWithBusiness(ctx.app, 'beh-e');
      const { key } = await keyOf(o);
      await events({
        key,
        events: [
          { k: 'page', l: '/sale/' },
          { k: 'section', l: '/sale/#pricing' },
          { k: 'section', l: '/sale?x=1#pricing' },
          { k: 'section', l: '/sale#  ' }, // no name
          { k: 'sclick', l: '/sale/#pricing' },
          { k: 'section', l: 'no hash at all' },
          { k: 'section', l: `/${'p'.repeat(100)}#${'n'.repeat(80)}` },
        ],
      });
      const b = await behavior(o);
      expect(b.sections).toContainEqual({
        path: '/sale',
        name: 'pricing',
        views: 2,
        clicks: 1,
        pageViews: 1,
      });
      expect(b.sections).toHaveLength(2);
      const long = b.sections.find((x: { name: string }) => x.name.startsWith('n'))!;
      expect(`${long.path}#${long.name}`.length).toBeLessThanOrEqual(100);
    });

    it('stores only known labels, ignores bots, wrong keys and other businesses', async () => {
      const a = await ownerWithBusiness(ctx.app, 'beh-b');
      const other = await ownerWithBusiness(ctx.app, 'beh-c');
      const { key } = await keyOf(a);
      await events({
        key,
        events: [
          { k: 'device', l: 'toaster' },
          { k: 'click', l: 'carrier-pigeon' },
          { k: 'scroll', l: '75' },
          { k: 'form', l: 'sent' },
          { k: 'page', l: '/x'.repeat(200) },
        ],
      });
      const rows = await ctx.prisma.eventCount.findMany();
      expect(rows.map((r) => r.kind)).toEqual(['page']);
      expect(rows[0]!.label.length).toBeLessThanOrEqual(100);
      await ctx.prisma.eventCount.deleteMany();

      await events({ key, events: [{ k: 'page', l: '/' }] }, 'Googlebot/2.1');
      const wrong = await events({
        key: key.slice(0, -1) + (key.endsWith('A') ? 'B' : 'A'),
        events: [{ k: 'page', l: '/' }],
      });
      expect(wrong.statusCode).toBe(400);
      expect((await events({ key, events: [{ k: 'nonsense' }] })).statusCode).toBe(400);
      expect(await ctx.prisma.eventCount.count()).toBe(0);
      await events({ key, events: [{ k: 'page', l: '/' }] });
      expect((await behavior(a)).pageViews).toBe(1);
      expect((await behavior(other)).pageViews).toBe(0);
    });
  });
});
