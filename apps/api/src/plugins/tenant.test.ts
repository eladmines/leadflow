import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, resetDb } from '../../test/helpers';
import { bpaths, ownerWithBusiness, req } from '../../test/business-helpers';

/**
 * Tenant isolation (AC-05). Every route registered under the tenant scope is discovered
 * automatically, so routes added by later features are covered without changes here.
 */
describe('tenant isolation: route walker', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let routes: { method: string; url: string }[];

  beforeAll(async () => {
    ctx = await createTestApp();
    routes = ctx.app.routeTable.filter(
      (r) => ctx.app.tenantRouteUrls.has(r.url) && r.method !== 'HEAD',
    );
  });
  afterAll(() => ctx.close());
  beforeEach(() => resetDb(ctx.prisma));

  it('finds the tenant routes', () => {
    expect(routes.length).toBeGreaterThanOrEqual(4);
  });

  it('every route under /api/v1/businesses/:businessId is inside the tenant scope', () => {
    const all = ctx.app.routeTable.filter((r) => r.url.startsWith(bpaths.tenantPrefix));
    for (const r of all) expect(ctx.app.tenantRouteUrls.has(r.url), r.url).toBe(true);
  });

  it("a member of business B gets 404 on every route of business A, and A's data is untouched", async () => {
    const a = await ownerWithBusiness(ctx.app, 'a');
    const b = await ownerWithBusiness(ctx.app, 'b');
    const before = await ctx.prisma.business.findUniqueOrThrow({ where: { id: a.business.id } });

    for (const r of routes) {
      const url = r.url.replace(':businessId', a.business.id);
      const res = await req(ctx.app, r.method as never, url, b.token, {
        name: 'השתלטות',
        businessId: b.business.id,
      });
      expect(res.statusCode, `${r.method} ${r.url}`).toBe(404);
      expect(res.json().error.code).toBe('NOT_FOUND');
    }

    const after = await ctx.prisma.business.findUniqueOrThrow({ where: { id: a.business.id } });
    expect(after).toEqual(before);
  });

  it('anonymous callers get 401 on every tenant route', async () => {
    const a = await ownerWithBusiness(ctx.app, 'a');
    for (const r of routes) {
      const url = r.url.replace(':businessId', a.business.id);
      const res = await req(ctx.app, r.method as never, url, undefined, {});
      expect(res.statusCode, `${r.method} ${r.url}`).toBe(401);
    }
  });

  it('unknown or malformed business ids return 404 for a signed-in user', async () => {
    const a = await ownerWithBusiness(ctx.app, 'a');
    for (const id of ['00000000-0000-4000-8000-000000000000', 'not-a-uuid', "1' OR '1'='1"]) {
      for (const r of routes) {
        const url = r.url.replace(':businessId', encodeURIComponent(id));
        const res = await req(ctx.app, r.method as never, url, a.token, {});
        expect(res.statusCode, `${r.method} ${url}`).toBe(404);
      }
    }
  });

  it('a disabled membership loses access', async () => {
    const a = await ownerWithBusiness(ctx.app, 'a');
    await ctx.prisma.membership.updateMany({
      where: { businessId: a.business.id },
      data: { status: 'DISABLED' },
    });
    const res = await req(ctx.app, 'GET', bpaths.detail(a.business.id), a.token);
    expect(res.statusCode).toBe(404);
  });
});
