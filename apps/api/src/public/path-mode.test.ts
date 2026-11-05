import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { apiPaths, LEAD_FORM_PATH } from '@leadflow/shared';
import { createTestApp, resetDb, testConfig } from '../../test/helpers';
import { ownerWithBusiness, req } from '../../test/business-helpers';
import { createFormToken } from '../lib/form-token';
import { DatabaseStorage } from '../integrations/storage';
import { buildPublicApp } from './app';

const sp = apiPaths.site;
const APP_URL = 'https://leadflow-test.onrender.com';

/** Hosting without a domain (D-119): sites under APP_URL/s/<sub>, the web app from the API. */
describe('free hosting: sites under a path, images in Postgres, web app from the API', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let pub: Awaited<ReturnType<typeof buildPublicApp>>;
  let webDir: string;

  beforeAll(async () => {
    webDir = await mkdtemp(path.join(tmpdir(), 'lf-web-'));
    await mkdir(path.join(webDir, 'assets'));
    await writeFile(path.join(webDir, 'index.html'), '<!doctype html><title>LeadFlow</title>');
    await writeFile(path.join(webDir, 'assets', 'app-abc123.js'), 'console.log(1)');
    ctx = await createTestApp({
      config: testConfig({
        PUBLIC_SITE_MODE: 'path',
        APP_URL,
        WEB_DIST_DIR: webDir,
        LEAD_FORM_RATE_LIMIT_MAX: '1000',
      }),
    });
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

  async function liveSite(sub: string) {
    const o = await ownerWithBusiness(ctx.app);
    const id = o.business.id;
    await req(ctx.app, 'PATCH', apiPaths.businesses.detail(id), o.token, { phone: '050-1111111' });
    const site = (
      await req(ctx.app, 'POST', sp.site(id), o.token, { templateKey: 'beauty' })
    ).json().site;
    await req(ctx.app, 'PUT', sp.subdomain(id), o.token, { subdomain: sub });
    await req(ctx.app, 'POST', sp.publish(id), o.token, { revision: 0 });
    const contactId = site.sections.find((s: { type: string }) => s.type === 'contact').id;
    return { ...o, id, contactId };
  }

  it('gives the site a path address on the app, shown as a prefix in the editor', async () => {
    const o = await liveSite('salon');
    const site = (await req(ctx.app, 'GET', sp.site(o.id), o.token)).json().site;
    expect(site.publicUrl).toBe(`${APP_URL}/s/salon`);
    expect(site.publicPrefix).toBe('leadflow-test.onrender.com/s/');
  });

  it('serves the site under /s/<sub> with its links and form under the same path', async () => {
    await liveSite('salon');
    const page = await pub.inject({ method: 'GET', url: '/s/salon/' });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain(`action="/s/salon${LEAD_FORM_PATH}"`);
    expect(page.body).toContain('href="/s/salon/"');
    expect(page.body).not.toMatch(/\shref="\/(?!s\/salon\/|\/)/);
    // Images stay on the app's own /media (same origin); only links and the form move.
    expect(page.body).not.toContain('src="/s/');
    expect((await pub.inject({ method: 'GET', url: '/s/salon' })).statusCode).toBe(200);
    expect((await pub.inject({ method: 'GET', url: '/s/nobody/' })).statusCode).toBe(404);
    expect((await pub.inject({ method: 'GET', url: '/s/salon/nope' })).statusCode).toBe(404);
    const sitemap = await pub.inject({ method: 'GET', url: '/s/salon/sitemap.xml' });
    expect(sitemap.body).toContain(`<loc>${APP_URL}/s/salon/</loc>`);
  });

  it('takes a lead from the form under the path', async () => {
    const o = await liveSite('salon');
    const res = await pub.inject({
      method: 'POST',
      url: `/s/salon${LEAD_FORM_PATH}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        _t: createFormToken(ctx.app.config.FORM_TOKEN_SECRET, 'salon', Date.now() - 10_000),
        _s: o.contactId,
        website: '',
        name: 'דנה כהן',
        phone: '052-7654321',
        consent: 'on',
      }).toString(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('תודה!');
    expect(res.body).toContain('href="/s/salon/"');
    const lead = await ctx.prisma.lead.findFirstOrThrow({ where: { businessId: o.id } });
    expect(lead.sourceUrl).toBe(`${APP_URL}/s/salon/`);
    // A token for another site doesn't work here.
    const other = await pub.inject({
      method: 'POST',
      url: `/s/salon${LEAD_FORM_PATH}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        _t: createFormToken(ctx.app.config.FORM_TOKEN_SECRET, 'other', Date.now() - 10_000),
        _s: o.contactId,
        name: 'x',
        phone: '052-7654321',
        consent: 'on',
      }).toString(),
    });
    expect(other.statusCode).toBe(400);
  });

  it('serves the web app: real files, index.html for page paths, JSON 404 for the API', async () => {
    const shell = await ctx.app.inject({ method: 'GET', url: '/b/123/leads' });
    expect(shell.statusCode).toBe(200);
    expect(shell.headers['content-type']).toContain('text/html');
    expect(shell.body).toContain('<title>LeadFlow</title>');
    const asset = await ctx.app.inject({ method: 'GET', url: '/assets/app-abc123.js' });
    expect(asset.headers['content-type']).toContain('text/javascript');
    expect(asset.headers['cache-control']).toContain('immutable');
    expect((await ctx.app.inject({ method: 'GET', url: '/assets/gone.js' })).statusCode).toBe(404);
    const api = await ctx.app.inject({ method: 'GET', url: '/api/v1/nothing-here' });
    expect(api.statusCode).toBe(404);
    expect(api.json().error.code).toBe('NOT_FOUND');
    const escape = await ctx.app.inject({ method: 'GET', url: '/..%2f..%2fpackage.json' });
    expect(escape.body).toContain('<title>LeadFlow</title>');
  });

  it('keeps images in Postgres when the disk is not kept', async () => {
    const store = new DatabaseStorage(ctx.prisma);
    const key = `${crypto.randomUUID()}/${crypto.randomUUID()}.webp`;
    await store.put(key, Buffer.from('webp-bytes'), 'image/webp');
    expect((await store.get(key))?.toString()).toBe('webp-bytes');
    await store.put(key, Buffer.from('again'), 'image/webp');
    expect((await store.get(key))?.toString()).toBe('again');
    await store.delete(key);
    expect(await store.get(key)).toBeNull();
    await expect(store.get('../etc/passwd')).rejects.toThrow('invalid storage key');
  });
});
