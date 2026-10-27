import {
  apiPaths,
  buildTemplateDraft,
  businessWebPaths,
  type Asset,
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
  noContent,
  renderApp,
  testBusiness,
  testUser,
} from '../../test/utils';
import { siteBusinessInfo } from '../site/api';

afterEach(() => vi.unstubAllGlobals());

const id = testBusiness.id;
const meKey = `GET ${apiPaths.auth.me}`;
const assetsKey = `GET ${apiPaths.media.assets(id)}`;
const sitePath = businessWebPaths.section(id, 'site');
const logo: Asset = {
  id: '9a000000-0000-4000-8000-000000000001',
  url: `/media/${id}/9a000000-0000-4000-8000-000000000001.webp`,
  width: 400,
  height: 200,
  sizeBytes: 12_000,
  originalName: 'logo.png',
  createdAt: new Date().toISOString(),
};
const site: Site = {
  id: '7e1f2a3b-4c5d-4e6f-8a9b-0c1d2e3f4a5b',
  subdomain: null,
  publicUrl: null,
  publicDomain: 'lvh.me:4100',
  published: null,
  ...buildTemplateDraft('beauty', siteBusinessInfo(testBusiness)),
  revision: 0,
  status: 'DRAFT',
  updatedAt: new Date().toISOString(),
};
const library = (assets: Asset[]) => ({
  [assetsKey]: () => json(200, { assets, usedBytes: 12_000, quotaBytes: 200 * 1024 * 1024 }),
});
const editor = (extra = {}) => ({
  [meKey]: me(testUser),
  [`GET ${apiPaths.site.site(id)}`]: () => json(200, { site }),
  [`PUT ${apiPaths.site.draft(id)}`]: (body: unknown) =>
    json(200, { site: { ...site, ...(body as object), revision: 1 } }),
  ...extra,
});
const previewHtml = () =>
  (screen.getByTitle('תצוגה מקדימה של האתר') as HTMLIFrameElement).getAttribute('srcdoc') ?? '';
const openDesign = async (user: ReturnType<typeof renderApp>['user']) =>
  user.click(await screen.findByRole('tab', { name: 'עיצוב' }));

describe('logo and image library', () => {
  it('picks a logo from the library; autosaves it and shows it in the preview', async () => {
    const fetchMock = mockApi(editor(library([logo])));
    const { user } = renderApp(sitePath);
    await openDesign(user);
    await user.click(screen.getByRole('button', { name: 'בחירת לוגו' }));
    const dialog = await screen.findByRole('dialog', { name: 'לוגו' });
    await user.click(await within(dialog).findByRole('button', { name: 'בחירת logo.png' }));
    await waitFor(() => expect(callsTo(fetchMock, 'PUT', apiPaths.site.draft(id)).length).toBe(1), {
      timeout: 3000,
    });
    expect(callsTo(fetchMock, 'PUT', apiPaths.site.draft(id))[0].theme.logoAssetId).toBe(logo.id);
    await waitFor(() => expect(previewHtml()).toContain(`<img class="logo" src="${logo.url}"`));
    expect(screen.getByRole('button', { name: 'הסרת לוגו' })).toBeInTheDocument();
  });

  it('uploads a file as multipart and selects it', async () => {
    const fetchMock = mockApi(
      editor({
        ...library([]),
        [`POST ${apiPaths.media.assets(id)}`]: () => json(201, { asset: logo }),
      }),
    );
    const { user } = renderApp(sitePath);
    await openDesign(user);
    await user.click(screen.getByRole('button', { name: 'בחירת לוגו' }));
    const dialog = await screen.findByRole('dialog', { name: 'לוגו' });
    const file = new File([new Uint8Array([1, 2, 3])], 'logo.png', { type: 'image/png' });
    await user.upload(within(dialog).getByLabelText(/העלאת תמונה/), file);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const call = fetchMock.mock.calls.find(
      ([u, init]) => String(u) === apiPaths.media.assets(id) && init?.method === 'POST',
    );
    expect(call?.[1]?.body).toBeInstanceOf(FormData);
    expect(new Headers(call?.[1]?.headers).get('Content-Type')).toBeNull(); // browser sets the multipart boundary
  });

  it('rejects wrong types and big files in the browser before uploading', async () => {
    const fetchMock = mockApi(editor(library([])));
    const { user } = renderApp(sitePath);
    await openDesign(user);
    await user.click(screen.getByRole('button', { name: 'בחירת לוגו' }));
    const dialog = await screen.findByRole('dialog', { name: 'לוגו' });
    const input = within(dialog).getByLabelText(/העלאת תמונה/);
    await user.upload(
      input,
      new File([new Uint8Array(9 * 1024 * 1024)], 'huge.jpg', { type: 'image/jpeg' }),
    );
    expect(await within(dialog).findByText('הקובץ גדול מדי (עד 8MB)')).toBeInTheDocument();
    expect(callsTo(fetchMock, 'POST', apiPaths.media.assets(id))).toHaveLength(0);
  });

  it('explains why an image in use cannot be deleted', async () => {
    mockApi(
      editor({
        ...library([logo]),
        [`DELETE ${apiPaths.media.asset(id, logo.id)}`]: () =>
          apiError(409, 'CONFLICT', 'התמונה בשימוש באתר. הסירו אותה מהאתר לפני המחיקה'),
      }),
    );
    const { user } = renderApp(sitePath);
    await openDesign(user);
    await user.click(screen.getByRole('button', { name: 'בחירת לוגו' }));
    const dialog = await screen.findByRole('dialog', { name: 'לוגו' });
    await user.click(await within(dialog).findByRole('button', { name: 'מחיקת logo.png' }));
    await user.click(within(dialog).getByRole('button', { name: 'מחיקה' }));
    expect(await within(dialog).findByText(/בשימוש באתר/)).toBeInTheDocument();
  });
});

describe('gallery section', () => {
  it('adds an image with a caption; it renders in the preview with alt text', async () => {
    const fetchMock = mockApi(
      editor({ ...library([logo]), [`DELETE ${apiPaths.media.asset(id, logo.id)}`]: noContent }),
    );
    const { user } = renderApp(sitePath);
    await user.selectOptions(await screen.findByLabelText('הוספת מקטע'), 'gallery');
    await user.click(screen.getByRole('button', { name: 'הוספה' }));
    await user.click(await screen.findByRole('button', { name: 'הוספת תמונה' }));
    const dialog = await screen.findByRole('dialog', { name: 'הוספת תמונה לגלריה' });
    await user.click(await within(dialog).findByRole('button', { name: 'בחירת logo.png' }));
    await user.type(screen.getByLabelText('כיתוב לתמונה 1'), 'הסלון מבפנים');
    await waitFor(() => expect(previewHtml()).toContain('alt="הסלון מבפנים"'));
    await waitFor(
      () => {
        const last = callsTo(fetchMock, 'PUT', apiPaths.site.draft(id)).at(-1);
        expect(last?.sections.at(-1)).toMatchObject({
          type: 'gallery',
          items: [{ assetId: logo.id, caption: 'הסלון מבפנים' }],
        });
      },
      { timeout: 3000 },
    );
  });
});
