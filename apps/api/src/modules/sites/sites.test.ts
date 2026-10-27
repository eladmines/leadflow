import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { apiPaths } from '@leadflow/shared';
import { createTestApp, resetDb } from '../../../test/helpers';
import { addMember, newUser, ownerWithBusiness, req } from '../../../test/business-helpers';

const sp = apiPaths.site;

describe('site builder API', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());
  beforeEach(() => resetDb(ctx.prisma));

  async function ownerWithSite(templateKey = 'beauty') {
    const o = await ownerWithBusiness(ctx.app);
    const res = await req(ctx.app, 'POST', sp.site(o.business.id), o.token, { templateKey });
    expect(res.statusCode).toBe(201);
    return { ...o, site: res.json().site };
  }

  it('returns null before a site exists', async () => {
    const o = await ownerWithBusiness(ctx.app);
    const res = await req(ctx.app, 'GET', sp.site(o.business.id), o.token);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ site: null });
  });

  it('creates a site from a template pre-filled with the business name, once', async () => {
    const o = await ownerWithSite('trades');
    expect(o.site).toMatchObject({ templateKey: 'trades', revision: 0, status: 'DRAFT' });
    expect(o.site.sections[0]).toMatchObject({ type: 'hero', title: 'מספרת שירן' });
    const again = await req(ctx.app, 'POST', sp.site(o.business.id), o.token, {
      templateKey: 'beauty',
    });
    expect(again.statusCode).toBe(409);
    expect(await ctx.prisma.auditLog.count({ where: { action: 'site.created' } })).toBe(1);
  });

  it('saves the draft with revision locking: stale revisions get 409 (AC-03 groundwork)', async () => {
    const o = await ownerWithSite();
    const draft = {
      ...o.site,
      revision: 0,
      sections: [{ ...o.site.sections[0], title: 'כותרת חדשה' }],
    };
    delete draft.id;
    delete draft.status;
    delete draft.updatedAt;

    const first = await req(ctx.app, 'PUT', sp.draft(o.business.id), o.token, draft);
    expect(first.statusCode).toBe(200);
    expect(first.json().site).toMatchObject({ revision: 1, sections: [{ title: 'כותרת חדשה' }] });

    // A second editor still holding revision 0 must not overwrite.
    const stale = await req(ctx.app, 'PUT', sp.draft(o.business.id), o.token, {
      ...draft,
      sections: [],
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.message).toMatch(/בחלון אחר/);
    const now = await req(ctx.app, 'GET', sp.site(o.business.id), o.token);
    expect(now.json().site.sections).toHaveLength(1);
  });

  it('rejects invalid drafts (unknown section type, duplicate ids, oversized text)', async () => {
    const o = await ownerWithSite();
    const base = { revision: 0, templateKey: 'beauty', theme: o.site.theme, seo: o.site.seo };
    for (const sections of [
      [{ id: 'x', type: 'script', visible: true }],
      [o.site.sections[0], o.site.sections[0]],
      [{ ...o.site.sections[0], title: 'א'.repeat(500) }],
    ]) {
      const res = await req(ctx.app, 'PUT', sp.draft(o.business.id), o.token, {
        ...base,
        sections,
      });
      expect(res.statusCode).toBe(400);
    }
  });

  it('stores user text as data (escaping happens at render time)', async () => {
    const o = await ownerWithSite();
    const evil = '<script>alert(1)</script>';
    const res = await req(ctx.app, 'PUT', sp.draft(o.business.id), o.token, {
      revision: 0,
      templateKey: 'beauty',
      theme: o.site.theme,
      seo: o.site.seo,
      sections: [{ ...o.site.sections[0], title: evil }],
    });
    expect(res.json().site.sections[0].title).toBe(evil);
  });

  it('PUT before a site exists → 404', async () => {
    const o = await ownerWithBusiness(ctx.app);
    const res = await req(ctx.app, 'PUT', sp.draft(o.business.id), o.token, {
      revision: 0,
      templateKey: 'beauty',
      theme: { palette: 'teal', font: 'rubik' },
      seo: { title: '', description: '' },
      sections: [],
    });
    expect(res.statusCode).toBe(404);
  });

  it('managers and employees can view the site but not create or edit it (PRD §20)', async () => {
    const o = await ownerWithSite();
    for (const role of ['MANAGER', 'EMPLOYEE'] as const) {
      const u = await newUser(ctx.app, role.toLowerCase());
      await addMember(ctx.prisma, o.business.id, u.userId, role);
      expect((await req(ctx.app, 'GET', sp.site(o.business.id), u.token)).statusCode).toBe(200);
      const put = await req(ctx.app, 'PUT', sp.draft(o.business.id), u.token, {
        revision: 0,
        templateKey: 'beauty',
        theme: o.site.theme,
        seo: o.site.seo,
        sections: [],
      });
      expect(put.statusCode).toBe(403);
    }
  });
});
