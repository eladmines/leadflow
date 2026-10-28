import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { apiPaths, LEAD_FORM_PATH, newPage } from '@leadflow/shared';
import { createFormToken } from '../../lib/form-token';
import { createTestApp, resetDb } from '../../../test/helpers';
import { addMember, newUser, ownerWithBusiness, req } from '../../../test/business-helpers';
import { buildPublicApp } from '../../public/app';

const sp = apiPaths.site;

describe('publishing (F06)', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let pub: Awaited<ReturnType<typeof buildPublicApp>>;

  beforeAll(async () => {
    ctx = await createTestApp();
    pub = await buildPublicApp({
      config: ctx.app.config,
      prisma: ctx.prisma,
      cache: ctx.app.siteCache,
      email: ctx.email,
    });
  });
  afterAll(async () => {
    await pub.close();
    await ctx.close();
  });
  beforeEach(() => resetDb(ctx.prisma));

  const visit = (sub: string, path = '/') =>
    pub.inject({
      method: 'GET',
      url: path,
      headers: { host: `${sub}.${ctx.app.config.PUBLIC_SITE_HOST}` },
    });

  async function ownerWithSite(label = 'owner') {
    const o = await ownerWithBusiness(ctx.app, label);
    await req(ctx.app, 'PATCH', apiPaths.businesses.detail(o.business.id), o.token, {
      phone: '050-1234567',
    });
    const res = await req(ctx.app, 'POST', sp.site(o.business.id), o.token, {
      templateKey: 'beauty',
    });
    return { ...o, id: o.business.id, site: res.json().site };
  }
  async function editTitle(o: { id: string; token: string }, title: string) {
    const cur = (await req(ctx.app, 'GET', sp.site(o.id), o.token)).json().site;
    const res = await req(ctx.app, 'PUT', sp.draft(o.id), o.token, {
      revision: cur.revision,
      templateKey: cur.templateKey,
      theme: cur.theme,
      seo: cur.seo,
      sections: [{ ...cur.sections[0], title }, ...cur.sections.slice(1)],
    });
    expect(res.statusCode).toBe(200);
    return res.json().site;
  }
  const publish = (o: { id: string; token: string }, revision: number) =>
    req(ctx.app, 'POST', sp.publish(o.id), o.token, { revision });

  it('publishes extra pages: served by address, in the menu and sitemap; forms work from any page (D-081)', async () => {
    const o = await ownerWithSite('pages');
    await req(ctx.app, 'PUT', sp.subdomain(o.id), o.token, { subdomain: 'pages-salon' });
    let n = 0;
    const id = () => `pg${++n}`;
    const about = newPage('about', 'p-about', id);
    const offer = { ...newPage('landing', 'p-offer', id), slug: 'summer' };
    const cur = (await req(ctx.app, 'GET', sp.site(o.id), o.token)).json().site;
    const saved = await req(ctx.app, 'PUT', sp.draft(o.id), o.token, {
      ...cur,
      pages: [about, offer],
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().site.pages.map((p: { slug: string }) => p.slug)).toEqual([
      'about',
      'summer',
    ]);
    expect((await publish(o, saved.json().site.revision)).statusCode).toBe(200);

    const home = await visit('pages-salon');
    expect(home.body).toContain('<a href="/about">אודות</a>');
    const aboutPage = await visit('pages-salon', '/about/');
    expect(aboutPage.statusCode).toBe(200);
    expect(aboutPage.body).toContain('<title>אודות · ');
    expect(aboutPage.headers['cache-control']).toBe('no-store');
    expect((await visit('pages-salon', '/summer')).statusCode).toBe(200);
    expect((await visit('pages-salon', '/nope')).statusCode).toBe(404);
    const map = await visit('pages-salon', '/sitemap.xml');
    expect(map.body).toContain('/about</loc>');
    expect(map.body).toContain('/summer</loc>');

    // A form on the landing page creates a lead that records the page.
    const contact = offer.sections.find((s) => s.type === 'contact')!;
    const token = createFormToken(
      ctx.app.config.FORM_TOKEN_SECRET,
      'pages-salon',
      Date.now() - 10_000,
    );
    const sent = await pub.inject({
      method: 'POST',
      url: LEAD_FORM_PATH,
      headers: {
        host: `pages-salon.${ctx.app.config.PUBLIC_SITE_HOST}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: new URLSearchParams({
        _t: token,
        _s: contact.id,
        _p: 'summer',
        name: 'דנה כהן',
        phone: '052-7654321',
        consent: 'on',
      }).toString(),
    });
    expect(sent.statusCode).toBe(200);
    const lead = await ctx.prisma.lead.findFirstOrThrow();
    expect(lead.sourceUrl).toMatch(/\/summer$/);
  });

  it('rejects duplicate page addresses', async () => {
    const o = await ownerWithSite('dupes');
    let n = 0;
    const id = () => `d${++n}`;
    const cur = (await req(ctx.app, 'GET', sp.site(o.id), o.token)).json().site;
    const res = await req(ctx.app, 'PUT', sp.draft(o.id), o.token, {
      ...cur,
      pages: [newPage('about', 'a1', id), newPage('about', 'a2', id)],
    });
    expect(res.statusCode).toBe(400);
  });

  it('requires a subdomain before publishing', async () => {
    const o = await ownerWithSite();
    const res = await publish(o, 0);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.fields.subdomain).toBeTruthy();
  });

  it('validates, normalises and reserves subdomains; unique across businesses', async () => {
    const a = await ownerWithSite('a');
    const b = await ownerWithSite('b');
    expect(
      (await req(ctx.app, 'PUT', sp.subdomain(a.id), a.token, { subdomain: 'www' })).statusCode,
    ).toBe(400);
    expect(
      (await req(ctx.app, 'PUT', sp.subdomain(a.id), a.token, { subdomain: 'שירן' })).statusCode,
    ).toBe(400);
    const ok = await req(ctx.app, 'PUT', sp.subdomain(a.id), a.token, { subdomain: ' Shiran ' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().site).toMatchObject({
      subdomain: 'shiran',
      publicUrl: `http://shiran.${ctx.app.config.PUBLIC_SITE_HOST}`,
    });
    const taken = await req(ctx.app, 'PUT', sp.subdomain(b.id), b.token, { subdomain: 'shiran' });
    expect(taken.statusCode).toBe(409);
    expect(taken.json().error.fields.subdomain).toMatch(/תפוסה/);
  });

  it('publishes the draft; editing the draft does not change the live site until republish (AC-02, AC-03)', async () => {
    const o = await ownerWithSite();
    await req(ctx.app, 'PUT', sp.subdomain(o.id), o.token, { subdomain: 'shiran' });
    expect((await visit('shiran')).statusCode).toBe(404); // not published yet

    const v1 = await editTitle(o, 'גרסה ראשונה');
    const pubRes = await publish(o, v1.revision);
    expect(pubRes.statusCode).toBe(200);
    expect(pubRes.json().site).toMatchObject({
      status: 'PUBLISHED',
      published: { number: 1, revision: v1.revision },
    });

    let page = await visit('shiran');
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('גרסה ראשונה');
    expect(page.body).toContain('050-1234567');

    const v2 = await editTitle(o, 'טיוטה חדשה');
    page = await visit('shiran');
    expect(page.body).toContain('גרסה ראשונה');
    expect(page.body).not.toContain('טיוטה חדשה');

    expect((await publish(o, v2.revision)).json().site.published.number).toBe(2);
    expect((await visit('shiran')).body).toContain('טיוטה חדשה');
    expect(await ctx.prisma.auditLog.count({ where: { action: 'site.published' } })).toBe(2);
  });

  it('refuses to publish a stale revision and keeps the live version', async () => {
    const o = await ownerWithSite();
    await req(ctx.app, 'PUT', sp.subdomain(o.id), o.token, { subdomain: 'shiran' });
    const v1 = await editTitle(o, 'חי');
    await publish(o, v1.revision);
    await editTitle(o, 'לא פורסם');
    const stale = await publish(o, v1.revision);
    expect(stale.statusCode).toBe(409);
    expect((await visit('shiran')).body).toContain('חי');
  });

  it('lists versions, rolls back, and unpublishes', async () => {
    const o = await ownerWithSite();
    await req(ctx.app, 'PUT', sp.subdomain(o.id), o.token, { subdomain: 'shiran' });
    await publish(o, (await editTitle(o, 'אחת')).revision);
    await publish(o, (await editTitle(o, 'שתיים')).revision);

    const list = (await req(ctx.app, 'GET', sp.versions(o.id), o.token)).json().versions;
    expect(list.map((v: { number: number; live: boolean }) => [v.number, v.live])).toEqual([
      [2, true],
      [1, false],
    ]);
    expect(list[0].publishedBy).toBeTruthy();

    const back = await req(ctx.app, 'POST', sp.rollback(o.id, list[1].id), o.token);
    expect(back.json().site.published.number).toBe(1);
    expect((await visit('shiran')).body).toContain('אחת');

    const off = await req(ctx.app, 'POST', sp.unpublish(o.id), o.token);
    expect(off.json().site).toMatchObject({ status: 'DRAFT', published: null });
    expect((await visit('shiran')).statusCode).toBe(404);
  });

  it("cannot roll back to another business's version (404)", async () => {
    const a = await ownerWithSite('a');
    const b = await ownerWithSite('b');
    await req(ctx.app, 'PUT', sp.subdomain(a.id), a.token, { subdomain: 'aaa' });
    await req(ctx.app, 'PUT', sp.subdomain(b.id), b.token, { subdomain: 'bbb' });
    await publish(a, 0);
    const aVersion = (await req(ctx.app, 'GET', sp.versions(a.id), a.token)).json().versions[0].id;
    const res = await req(ctx.app, 'POST', sp.rollback(b.id, aVersion), b.token);
    expect(res.statusCode).toBe(404);
    expect((await req(ctx.app, 'POST', sp.rollback(b.id, 'not-a-uuid'), b.token)).statusCode).toBe(
      404,
    );
    expect((await visit('bbb')).statusCode).toBe(404);
  });

  it('only the owner can choose an address, publish, roll back or unpublish', async () => {
    const o = await ownerWithSite();
    const m = await newUser(ctx.app, 'manager');
    await addMember(ctx.prisma, o.id, m.userId, 'MANAGER');
    expect(
      (await req(ctx.app, 'PUT', sp.subdomain(o.id), m.token, { subdomain: 'mgr' })).statusCode,
    ).toBe(403);
    expect((await publish({ id: o.id, token: m.token }, 0)).statusCode).toBe(403);
    expect((await req(ctx.app, 'POST', sp.unpublish(o.id), m.token)).statusCode).toBe(403);
    expect((await req(ctx.app, 'GET', sp.versions(o.id), m.token)).statusCode).toBe(200);
  });
});

describe('public site server', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let pub: Awaited<ReturnType<typeof buildPublicApp>>;

  beforeAll(async () => {
    ctx = await createTestApp();
    pub = await buildPublicApp({
      config: ctx.app.config,
      prisma: ctx.prisma,
      cache: ctx.app.siteCache,
      email: ctx.email,
    });
  });
  afterAll(async () => {
    await pub.close();
    await ctx.close();
  });
  beforeEach(() => resetDb(ctx.prisma));

  const host = (sub: string) => `${sub}.${ctx.app.config.PUBLIC_SITE_HOST}`;

  async function published(sub: string) {
    const o = await ownerWithBusiness(ctx.app);
    await req(ctx.app, 'POST', sp.site(o.business.id), o.token, { templateKey: 'trades' });
    await req(ctx.app, 'PUT', sp.subdomain(o.business.id), o.token, { subdomain: sub });
    await req(ctx.app, 'POST', sp.publish(o.business.id), o.token, { revision: 0 });
  }

  it('serves the page with strict security headers and caching', async () => {
    await published('garage');
    const res = await pub.inject({ method: 'GET', url: '/', headers: { host: host('garage') } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['content-security-policy']).not.toContain('script-src');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['cache-control']).toBe('no-store');
    // Each view gets its own form token (the placeholder never leaks to visitors).
    const again = await pub.inject({ method: 'GET', url: '/', headers: { host: host('garage') } });
    const token = (html: string) => /name="_t" value="([^"]+)"/.exec(html)?.[1];
    expect(token(res.body)).toMatch(/^\d{13}\./);
    expect(token(again.body)).not.toBe(token(res.body));
    expect(res.body).not.toContain('__LF_FORM_TOKEN__');
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(res.body).toContain('dir="rtl"');
  });

  it('serves robots.txt and sitemap.xml with the site origin', async () => {
    await published('garage');
    const robots = await pub.inject({
      method: 'GET',
      url: '/robots.txt',
      headers: { host: host('garage') },
    });
    expect(robots.body).toContain(`Sitemap: http://${host('garage')}/sitemap.xml`);
    const map = await pub.inject({
      method: 'GET',
      url: '/sitemap.xml',
      headers: { host: host('garage') },
    });
    expect(map.body).toContain(`<loc>http://${host('garage')}/</loc>`);
  });

  it.each([
    ['an unknown subdomain', () => host('nobody')],
    ['a foreign host', () => 'evil.example.com'],
    ['a nested subdomain', () => `a.b.${ctx.app.config.PUBLIC_SITE_HOST}`],
  ])('answers 404 (Hebrew page, noindex) for %s', async (_label, h) => {
    const res = await pub.inject({ method: 'GET', url: '/', headers: { host: h() } });
    expect(res.statusCode).toBe(404);
    expect(res.body).toContain('האתר לא נמצא');
    expect(res.body).toContain('noindex');
  });

  it('answers 404 for unknown paths on a live site', async () => {
    await published('garage');
    const res = await pub.inject({
      method: 'GET',
      url: '/wp-admin',
      headers: { host: host('garage') },
    });
    expect(res.statusCode).toBe(404);
    expect(res.body).toContain('העמוד לא נמצא');
  });
});
