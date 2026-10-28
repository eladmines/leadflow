import {
  apiPaths,
  buildTemplateDraft,
  businessWebPaths,
  type Business,
  type Site,
} from '@leadflow/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  apiError,
  callsTo,
  json,
  me,
  mockApi,
  renderApp,
  testBusiness,
  testUser,
} from '../../test/utils';
import { siteBusinessInfo } from './api';

afterEach(() => vi.unstubAllGlobals());

const sp = apiPaths.site;
const id = testBusiness.id;
const meKey = `GET ${apiPaths.auth.me}`;
const sitePath = businessWebPaths.section(id, 'site');
const base: Site = {
  id: '7e1f2a3b-4c5d-4e6f-8a9b-0c1d2e3f4a5b',
  subdomain: null,
  publicUrl: null,
  publicDomain: 'lvh.me:4100',
  published: null,
  ...buildTemplateDraft('beauty', siteBusinessInfo(testBusiness)),
  pages: [],
  revision: 3,
  status: 'DRAFT',
  updatedAt: '2026-10-27T10:00:00.000Z',
};
const withAddress = { ...base, subdomain: 'shiran', publicUrl: 'http://shiran.lvh.me:4100' };
const live: Site = {
  ...withAddress,
  status: 'PUBLISHED',
  published: {
    versionId: '1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e',
    number: 2,
    revision: 3,
    publishedAt: '2026-10-27T11:00:00.000Z',
  },
};
const getSite = (s: Site) => ({ [`GET ${sp.site(id)}`]: () => json(200, { site: s }) });

describe('publishing', () => {
  it('first publish: choose an address (validated), then publish and get the live link', async () => {
    const fetchMock = mockApi({
      [meKey]: me(testUser),
      ...getSite(base),
      [`PUT ${sp.subdomain(id)}`]: (body) =>
        (body as { subdomain: string }).subdomain === 'taken'
          ? apiError(409, 'CONFLICT', 'הכתובת הזו כבר תפוסה. נסו כתובת אחרת', {
              subdomain: 'הכתובת הזו כבר תפוסה. נסו כתובת אחרת',
            })
          : json(200, { site: withAddress }),
      [`POST ${sp.publish(id)}`]: () => json(200, { site: live }),
    });
    const { user } = renderApp(sitePath);
    await user.click(await screen.findByRole('button', { name: 'פרסום האתר' }));
    const dialog = await screen.findByRole('dialog', { name: 'בחירת כתובת לאתר' });
    const field = within(dialog).getByLabelText('כתובת האתר');
    expect(within(dialog).getByText('.lvh.me:4100')).toBeInTheDocument();

    await user.type(field, 'שירן');
    await user.click(within(dialog).getByRole('button', { name: 'שמירת הכתובת והמשך' }));
    expect(
      await within(dialog).findByText(/אותיות באנגלית, ספרות ומקף \(3–40/),
    ).toBeInTheDocument();

    await user.clear(field);
    await user.type(field, 'taken');
    await user.click(within(dialog).getByRole('button', { name: 'שמירת הכתובת והמשך' }));
    expect(
      await within(dialog).findByText('הכתובת הזו כבר תפוסה. נסו כתובת אחרת'),
    ).toBeInTheDocument();

    await user.clear(field);
    await user.type(field, 'Shiran');
    await user.click(within(dialog).getByRole('button', { name: 'שמירת הכתובת והמשך' }));
    const confirm = await screen.findByRole('dialog', { name: 'פרסום האתר' });
    expect(within(confirm).getByText('shiran.lvh.me:4100')).toBeInTheDocument();
    await user.click(within(confirm).getByRole('button', { name: 'פרסום האתר' }));

    const success = await screen.findByRole('dialog', { name: 'האתר באוויר!' });
    expect(within(success).getByRole('link', { name: /shiran\.lvh\.me:4100/ })).toHaveAttribute(
      'href',
      'http://shiran.lvh.me:4100',
    );
    expect(callsTo(fetchMock, 'PUT', sp.subdomain(id)).at(-1)).toEqual({ subdomain: 'shiran' });
    expect(callsTo(fetchMock, 'POST', sp.publish(id))).toEqual([{ revision: 3 }]);
    await user.click(within(success).getByRole('button', { name: 'חזרה לעריכה' }));
    expect(await screen.findByText('באוויר')).toBeInTheDocument();
  });

  it('shows "unpublished changes" after editing a live site', async () => {
    mockApi({
      [meKey]: me(testUser),
      ...getSite(live),
      [`PUT ${sp.draft(id)}`]: (body) =>
        json(200, { site: { ...live, ...(body as object), revision: 4 } }),
    });
    const { user } = renderApp(sitePath);
    expect(await screen.findByText('באוויר')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /shiran\.lvh\.me:4100/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'הסתרת המלצות' }));
    expect(await screen.findByText('באוויר · יש שינויים שלא פורסמו')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('כל השינויים נשמרו')).toBeInTheDocument(), {
      timeout: 3000,
    });
    expect(screen.getByText('באוויר · יש שינויים שלא פורסמו')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'פרסום השינויים' })).toBeInTheDocument();
  });

  it('history: lists versions and rolls back', async () => {
    const versions = [
      {
        id: live.published!.versionId,
        number: 2,
        publishedAt: '2026-10-27T11:00:00.000Z',
        publishedBy: 'שירן לוי',
        live: true,
      },
      {
        id: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d',
        number: 1,
        publishedAt: '2026-10-26T09:00:00.000Z',
        publishedBy: 'שירן לוי',
        live: false,
      },
    ];
    const fetchMock = mockApi({
      [meKey]: me(testUser),
      ...getSite(live),
      [`GET ${sp.versions(id)}`]: () => json(200, { versions }),
      [`POST ${sp.rollback(id, versions[1]!.id)}`]: () =>
        json(200, {
          site: {
            ...live,
            published: { ...live.published!, versionId: versions[1]!.id, number: 1 },
          },
        }),
    });
    const { user } = renderApp(sitePath);
    await user.click(await screen.findByRole('button', { name: 'היסטוריה' }));
    const dialog = await screen.findByRole('dialog', { name: 'היסטוריית פרסומים' });
    const list = await within(dialog).findByRole('list', { name: 'גרסאות שפורסמו' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(within(list).getByText('באוויר')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'החזרה לגרסה זו' }));
    await waitFor(() =>
      expect(callsTo(fetchMock, 'POST', sp.rollback(id, versions[1]!.id))).toHaveLength(1),
    );
  });

  it('managers do not get the publish button', async () => {
    mockApi({
      [meKey]: me(testUser),
      [`GET ${apiPaths.businesses.detail(id)}`]: () =>
        json(200, { business: { ...testBusiness, role: 'MANAGER' } as Business }),
      ...getSite(live),
    });
    renderApp(sitePath);
    expect(await screen.findByText('באוויר')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /פרסום/ })).not.toBeInTheDocument();
  });
});

describe('dashboard progress', () => {
  it('links the owner to build the site once the earlier steps are done', async () => {
    mockApi({ [meKey]: me({ ...testUser, emailVerified: true }) });
    renderApp(businessWebPaths.home(id));
    expect(await screen.findByRole('link', { name: 'לבניית האתר' })).toHaveAttribute(
      'href',
      sitePath,
    );
  });

  it('marks build + publish done for a live site', async () => {
    mockApi({ [meKey]: me({ ...testUser, emailVerified: true }), ...getSite(live) });
    renderApp(businessWebPaths.home(id));
    expect(await screen.findByText('הושלמו 4 מתוך 5')).toBeInTheDocument();
  });
});
