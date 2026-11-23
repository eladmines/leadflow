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
    expect(await by('+972523333333')).toBeNull();
  });

  it('rejects a wrong or another business key, and explains missing fields', async () => {
    const a = await ownerWithBusiness(ctx.app, 'embed-e');
    const { key } = await keyOf(a);
    expect((await post(base(key.slice(0, -1) + (key.endsWith('A') ? 'B' : 'A')))).statusCode).toBe(
      400,
    );
    expect((await post(base('0'.repeat(32) + '.' + 'A'.repeat(22)))).statusCode).toBe(400);

    const noConsent = await post(base(key, { consent: undefined }));
    expect(noConsent.statusCode).toBe(400);
    expect(noConsent.json().ok).toBe(false);
    expect(noConsent.json().errors).toContain('יש לאשר את יצירת הקשר כדי לשלוח');
    expect(await ctx.prisma.lead.count()).toBe(0);
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
});
