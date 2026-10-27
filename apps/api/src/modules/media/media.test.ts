import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { apiPaths } from '@leadflow/shared';
import {
  createTestApp,
  csrfHeaders,
  resetDb,
  sessionCookie,
  testConfig,
} from '../../../test/helpers';
import { addMember, newUser, ownerWithBusiness, req } from '../../../test/business-helpers';
import { buildPublicApp } from '../../public/app';

const mp = apiPaths.media;
const sp = apiPaths.site;

/** A real JPEG with EXIF/GPS-like metadata. */
async function jpeg(width = 3000, height = 2000) {
  return sharp({ create: { width, height, channels: 3, background: '#c86' } })
    .jpeg()
    .withMetadata({ exif: { IFD0: { Copyright: 'secret-owner', Artist: 'home-gps' } } })
    .toBuffer();
}

/** Random pixels: doesn't compress, so it reliably exceeds a tiny quota. */
async function noisy(width = 400, height = 300) {
  const raw = Buffer.alloc(width * height * 3);
  for (let i = 0; i < raw.length; i += 1) raw[i] = Math.floor(Math.random() * 256);
  return sharp(raw, { raw: { width, height, channels: 3 } })
    .jpeg()
    .toBuffer();
}

function multipart(filename: string, body: Buffer, contentType = 'image/jpeg') {
  const boundary = '----leadflowtest';
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    payload: Buffer.concat([head, body, tail]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

describe('media (F05)', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());
  beforeEach(() => resetDb(ctx.prisma));

  const upload = (
    app: typeof ctx.app,
    businessId: string,
    token: string,
    file: Buffer,
    name = 'photo.jpg',
    type?: string,
  ) => {
    const m = multipart(name, file, type);
    return app.inject({
      method: 'POST',
      url: mp.assets(businessId),
      headers: { ...csrfHeaders, ...sessionCookie(token), 'content-type': m.contentType },
      payload: m.payload,
    });
  };

  it('re-encodes uploads to WebP within 1920px, strips metadata, and serves them immutably', async () => {
    const o = await ownerWithBusiness(ctx.app);
    const res = await upload(ctx.app, o.business.id, o.token, await jpeg());
    expect(res.statusCode).toBe(201);
    const { asset } = res.json();
    expect(asset).toMatchObject({ width: 1920, height: 1280, originalName: 'photo.jpg' });
    expect(asset.url).toMatch(new RegExp(`^/media/${o.business.id}/[0-9a-f-]{36}\\.webp$`));

    const file = await ctx.app.inject({ method: 'GET', url: asset.url });
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-type']).toBe('image/webp');
    expect(file.headers['cache-control']).toContain('immutable');
    expect(file.headers['x-content-type-options']).toBe('nosniff');
    const meta = await sharp(file.rawPayload).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.exif).toBeUndefined();
    expect(file.rawPayload.includes(Buffer.from('secret-owner'))).toBe(false);

    const list = (await req(ctx.app, 'GET', mp.assets(o.business.id), o.token)).json();
    expect(list.assets).toHaveLength(1);
    expect(list.usedBytes).toBe(asset.sizeBytes);
  });

  it.each([
    [
      'a text file renamed .jpg',
      Buffer.from('definitely not an image'),
      'evil.jpg',
      'image/jpeg',
      /לא הצלחנו לקרוא/,
    ],
    [
      'an SVG (could carry script)',
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>',
      ),
      'x.svg',
      'image/svg+xml',
      /JPG, PNG או WebP/,
    ],
  ])('rejects %s', async (_l, body, name, type, message) => {
    const o = await ownerWithBusiness(ctx.app);
    const res = await upload(ctx.app, o.business.id, o.token, body, name, type);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(message);
    expect(await ctx.prisma.asset.count()).toBe(0);
  });

  it('rejects GIFs and files over 8MB', async () => {
    const o = await ownerWithBusiness(ctx.app);
    const gif = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#000' } })
      .gif()
      .toBuffer();
    expect(
      (await upload(ctx.app, o.business.id, o.token, gif, 'a.gif', 'image/gif')).statusCode,
    ).toBe(400);
    const big = await upload(
      ctx.app,
      o.business.id,
      o.token,
      Buffer.alloc(9 * 1024 * 1024, 1),
      'big.jpg',
    );
    expect(big.statusCode).toBe(400);
    expect(big.json().error.message).toMatch(/גדול מדי/);
  });

  it('enforces the per-business quota', async () => {
    const tiny = await createTestApp({ config: testConfig({ MEDIA_QUOTA_BYTES: '1000' }) });
    try {
      const o = await ownerWithBusiness(tiny.app);
      const res = await upload(tiny.app, o.business.id, o.token, await noisy());
      expect(res.statusCode).toBe(409);
      expect(res.json().error.message).toMatch(/מקום האחסון/);
    } finally {
      await tiny.close();
    }
  });

  it("a draft can't use another business's image; own images render on the published site", async () => {
    const a = await ownerWithBusiness(ctx.app, 'a');
    const b = await ownerWithBusiness(ctx.app, 'b');
    const mine = (await upload(ctx.app, a.business.id, a.token, await jpeg(400, 300))).json().asset;
    const theirs = (await upload(ctx.app, b.business.id, b.token, await jpeg(400, 300))).json()
      .asset;
    const site = (
      await req(ctx.app, 'POST', sp.site(a.business.id), a.token, { templateKey: 'beauty' })
    ).json().site;
    const draft = (logo: string) => ({
      ...site,
      revision: 0,
      theme: { ...site.theme, logoAssetId: logo },
    });

    const stolen = await req(ctx.app, 'PUT', sp.draft(a.business.id), a.token, draft(theirs.id));
    expect(stolen.statusCode).toBe(400);
    expect(stolen.json().error.message).toMatch(/אינה שייכת לעסק/);
    const ok = await req(ctx.app, 'PUT', sp.draft(a.business.id), a.token, draft(mine.id));
    expect(ok.statusCode).toBe(200);

    await req(ctx.app, 'PUT', sp.subdomain(a.business.id), a.token, { subdomain: 'salon-img' });
    await req(ctx.app, 'POST', sp.publish(a.business.id), a.token, { revision: 1 });
    const pub = await buildPublicApp({
      config: ctx.app.config,
      prisma: ctx.prisma,
      email: ctx.email,
      storage: ctx.app.storage,
      cache: ctx.app.siteCache,
    });
    try {
      const host = `salon-img.${ctx.app.config.PUBLIC_SITE_HOST}`;
      const page = await pub.inject({ method: 'GET', url: '/', headers: { host } });
      expect(page.body).toContain(`<img class="logo" src="${mine.url}"`);
      const img = await pub.inject({ method: 'GET', url: mine.url, headers: { host } });
      expect(img.statusCode).toBe(200);
      expect(img.headers['content-type']).toBe('image/webp');
    } finally {
      await pub.close();
    }
  });

  it('refuses to delete an image in use; deletes an unused one (file gone)', async () => {
    const o = await ownerWithBusiness(ctx.app);
    const used = (await upload(ctx.app, o.business.id, o.token, await jpeg(400, 300))).json().asset;
    const unused = (await upload(ctx.app, o.business.id, o.token, await jpeg(400, 300))).json()
      .asset;
    const site = (
      await req(ctx.app, 'POST', sp.site(o.business.id), o.token, { templateKey: 'beauty' })
    ).json().site;
    await req(ctx.app, 'PUT', sp.draft(o.business.id), o.token, {
      ...site,
      revision: 0,
      theme: { ...site.theme, logoAssetId: used.id },
    });

    const blocked = await req(ctx.app, 'DELETE', mp.asset(o.business.id, used.id), o.token);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.message).toMatch(/בשימוש באתר/);
    expect(
      (await req(ctx.app, 'DELETE', mp.asset(o.business.id, unused.id), o.token)).statusCode,
    ).toBe(204);
    expect((await ctx.app.inject({ method: 'GET', url: unused.url })).statusCode).toBe(404);
  });

  it('employees can view the library but not upload; foreign/odd media paths are 404', async () => {
    const o = await ownerWithBusiness(ctx.app);
    const emp = await newUser(ctx.app, 'emp');
    await addMember(ctx.prisma, o.business.id, emp.userId, 'EMPLOYEE');
    expect((await upload(ctx.app, o.business.id, emp.token, await jpeg(100, 100))).statusCode).toBe(
      403,
    );
    expect((await req(ctx.app, 'GET', mp.assets(o.business.id), emp.token)).statusCode).toBe(200);
    for (const url of [
      '/media/../../etc/passwd',
      '/media/%2e%2e/%2e%2e/etc/passwd',
      '/media/abc.webp',
    ]) {
      expect((await ctx.app.inject({ method: 'GET', url })).statusCode).toBe(404);
    }
  });
});
