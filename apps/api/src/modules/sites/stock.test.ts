import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { apiPaths, STOCK_MEDIA_PATH, TEMPLATE_KEYS } from '@leadflow/shared';
import { createTestApp, resetDb, testConfig } from '../../../test/helpers';
import { ownerWithBusiness, req } from '../../../test/business-helpers';

describe('template sample photos (D-069)', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  beforeAll(async () => {
    ctx = await createTestApp({ config: testConfig({ SITE_STOCK_IMAGES: 'true' }) });
  });
  afterAll(() => ctx.close());
  beforeEach(() => resetDb(ctx.prisma));

  it('a new site starts with hero and about photos copied into the business library', async () => {
    const o = await ownerWithBusiness(ctx.app);
    const id = o.business.id;
    const res = await req(ctx.app, 'POST', apiPaths.site.site(id), o.token, {
      templateKey: 'garage',
    });
    expect(res.statusCode).toBe(201);
    const sections = res.json().site.sections as {
      type: string;
      imageAssetId?: string | null;
      imageAlt?: string;
    }[];
    const hero = sections.find((s) => s.type === 'hero')!;
    const about = sections.find((s) => s.type === 'about')!;
    expect(about.imageAlt).toBe('מכונאי בודק מנוע של רכב');

    const library = (await req(ctx.app, 'GET', apiPaths.media.assets(id), o.token)).json();
    expect(library.assets.map((a: { id: string }) => a.id).sort()).toEqual(
      [hero.imageAssetId, about.imageAssetId].sort(),
    );
    expect(library.assets[0].originalName).toMatch(/^תמונה לדוגמה/);
    // Real uploads: re-encoded, stored and served like any image.
    const img = await ctx.app.inject({ method: 'GET', url: library.assets[0].url });
    expect(img.statusCode).toBe(200);
    expect(img.headers['content-type']).toBe('image/webp');

    // A second create is refused before any photo is copied.
    const again = await req(ctx.app, 'POST', apiPaths.site.site(id), o.token, {
      templateKey: 'beauty',
    });
    expect(again.statusCode).toBe(409);
    expect(await ctx.prisma.asset.count()).toBe(2);
  });

  it('serves every bundled photo for the template picker, and nothing else', async () => {
    for (const key of TEMPLATE_KEYS) {
      for (const slot of ['hero', 'about']) {
        const r = await ctx.app.inject({
          method: 'GET',
          url: `${STOCK_MEDIA_PATH}/${key}-${slot}.webp`,
        });
        expect(r.statusCode, `${key}-${slot}`).toBe(200);
      }
    }
    for (const bad of ['..%2F..%2Fpackage.json', 'beauty-hero.jpg', 'nope-hero.webp']) {
      expect(
        (await ctx.app.inject({ method: 'GET', url: `${STOCK_MEDIA_PATH}/${bad}` })).statusCode,
      ).toBe(404);
    }
  });
});
