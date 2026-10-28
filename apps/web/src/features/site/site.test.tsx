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

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

const sp = apiPaths.site;
const meKey = `GET ${apiPaths.auth.me}`;
const sitePath = businessWebPaths.section(testBusiness.id, 'site');
const draft = { ...buildTemplateDraft('beauty', siteBusinessInfo(testBusiness)), pages: [] };
const site: Site = {
  id: '7e1f2a3b-4c5d-4e6f-8a9b-0c1d2e3f4a5b',
  subdomain: null,
  publicUrl: null,
  publicDomain: 'lvh.me:4100',
  published: null,
  ...draft,
  revision: 0,
  status: 'DRAFT',
  updatedAt: '2026-10-27T10:00:00.000Z',
};
const getSite = (s: Site | null) => ({
  [`GET ${sp.site(testBusiness.id)}`]: () => json(200, { site: s }),
});
/** PUT that behaves like the API: bumps the revision. */
const putOk = (body: unknown) =>
  json(200, {
    site: { ...site, ...(body as object), revision: (body as { revision: number }).revision + 1 },
  });
const asRole = (role: Business['role']) => ({
  [`GET ${apiPaths.businesses.detail(testBusiness.id)}`]: () =>
    json(200, { business: { ...testBusiness, role } }),
});
const previewHtml = () =>
  (screen.getByTitle('תצוגה מקדימה של האתר') as HTMLIFrameElement).getAttribute('srcdoc') ?? '';

describe('template picker', () => {
  it('suggests the template for the industry and creates the site', async () => {
    const fetchMock = mockApi({
      [meKey]: me(testUser),
      ...getSite(null),
      [`POST ${sp.site(testBusiness.id)}`]: () => json(201, { site }),
    });
    const { user } = renderApp(sitePath);
    expect(
      await screen.findByRole('heading', { name: 'בואו נבנה את האתר שלך' }),
    ).toBeInTheDocument();
    const cards = screen.getAllByRole('article');
    expect(within(cards[0]!).getByText('מומלץ לעסק שלך')).toBeInTheDocument();
    expect(within(cards[0]!).getByRole('heading', { name: 'יופי וטיפוח' })).toBeInTheDocument();

    await user.click(within(cards[0]!).getByRole('button', { name: 'בחירת התבנית' }));
    expect(await screen.findByRole('heading', { name: 'האתר שלי' })).toBeInTheDocument();
    expect(callsTo(fetchMock, 'POST', sp.site(testBusiness.id))).toEqual([
      { templateKey: 'beauty' },
    ]);
  });

  it('non-owners see an empty state instead of the picker', async () => {
    mockApi({ [meKey]: me(testUser), ...asRole('EMPLOYEE'), ...getSite(null) });
    renderApp(sitePath);
    expect(await screen.findByRole('heading', { name: 'האתר עדיין לא נבנה' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'בחירת התבנית' })).not.toBeInTheDocument();
  });
});

describe('site editor', () => {
  it('a new landing page says it is not in the menu and can be added with one click', async () => {
    const fetchMock = mockApi({
      [meKey]: me(testUser),
      ...getSite(site),
      [`PUT ${sp.draft(testBusiness.id)}`]: putOk,
    });
    const { user } = renderApp(sitePath);
    await user.click(await screen.findByRole('button', { name: 'עמוד חדש' }));
    await user.click(
      within(await screen.findByRole('dialog', { name: 'עמוד חדש' })).getByRole('button', {
        name: /^דף נחיתה/,
      }),
    );
    expect(screen.getByText(/לא מופיע בתפריט האתר/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'הוספה לתפריט' }));
    expect(screen.queryByText(/לא מופיע בתפריט האתר/)).not.toBeInTheDocument();
    await waitFor(
      () =>
        expect(callsTo(fetchMock, 'PUT', sp.draft(testBusiness.id)).at(-1)?.pages[0]).toMatchObject(
          { slug: 'offer', inMenu: true },
        ),
      { timeout: 3000 },
    );
  });

  it('adds a page from a preset, switches to it and autosaves it (D-081)', async () => {
    const fetchMock = mockApi({
      [meKey]: me(testUser),
      ...getSite(site),
      [`PUT ${sp.draft(testBusiness.id)}`]: putOk,
    });
    const { user } = renderApp(sitePath);
    await user.click(await screen.findByRole('button', { name: 'עמוד חדש' }));
    const dialog = await screen.findByRole('dialog', { name: 'עמוד חדש' });
    await user.click(within(dialog).getByRole('button', { name: /^אודות/ }));
    expect(screen.getByRole('tab', { name: 'אודות' })).toHaveAttribute('aria-selected', 'true');
    await waitFor(
      () => expect(callsTo(fetchMock, 'PUT', sp.draft(testBusiness.id)).length).toBeGreaterThan(0),
      { timeout: 3000 },
    );
    const saved = callsTo(fetchMock, 'PUT', sp.draft(testBusiness.id)).at(-1);
    expect(saved.pages).toEqual([
      expect.objectContaining({ slug: 'about', title: 'אודות', inMenu: true }),
    ]);
    expect(saved.pages[0].sections.map((x: { type: string }) => x.type)).toEqual([
      'about',
      'testimonials',
      'cta',
    ]);

    // Page settings: an invalid address can't be saved.
    await user.click(screen.getByRole('button', { name: 'הגדרות העמוד' }));
    const settings = await screen.findByRole('dialog', { name: 'הגדרות העמוד' });
    await user.clear(within(settings).getByLabelText('כתובת העמוד'));
    await user.type(within(settings).getByLabelText('כתובת העמוד'), 'media');
    expect(within(settings).getByText(/שמורה למערכת/)).toBeInTheDocument();
    expect(within(settings).getByRole('button', { name: 'שמירה' })).toBeDisabled();
  });

  it('does not save anything just by opening the editor', async () => {
    const fetchMock = mockApi({
      [meKey]: me(testUser),
      ...getSite(site),
      [`PUT ${sp.draft(testBusiness.id)}`]: putOk,
    });
    renderApp(sitePath);
    expect(await screen.findByRole('heading', { name: 'האתר שלי' })).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 1200)); // longer than the autosave debounce
    expect(callsTo(fetchMock, 'PUT', sp.draft(testBusiness.id))).toHaveLength(0);
    expect(screen.getByText('כל השינויים נשמרו')).toBeInTheDocument();
  });

  it('edits a section, autosaves with the current revision and updates the preview', async () => {
    const fetchMock = mockApi({
      [meKey]: me(testUser),
      ...getSite(site),
      [`PUT ${sp.draft(testBusiness.id)}`]: putOk,
    });
    const { user } = renderApp(sitePath);
    await user.click(await screen.findByRole('button', { name: /^כותרת ראשית/ }));
    const title = screen.getByLabelText('כותרת');
    await user.clear(title);
    await user.type(title, 'שירן — עיצוב שיער');

    await waitFor(
      () => expect(callsTo(fetchMock, 'PUT', sp.draft(testBusiness.id)).length).toBeGreaterThan(0),
      {
        timeout: 3000,
      },
    );
    await waitFor(() => expect(screen.getByText('כל השינויים נשמרו')).toBeInTheDocument(), {
      timeout: 3000,
    });
    const puts = callsTo(fetchMock, 'PUT', sp.draft(testBusiness.id));
    expect(puts[0].revision).toBe(0);
    expect(puts.at(-1).sections[0].title).toBe('שירן — עיצוב שיער');
    // Later saves carry the revision returned by the previous one.
    if (puts.length > 1) expect(puts[1].revision).toBe(1);
    await waitFor(() => expect(previewHtml()).toContain('שירן — עיצוב שיער'));
  });

  it('hides and reorders sections', async () => {
    const fetchMock = mockApi({
      [meKey]: me(testUser),
      ...getSite(site),
      [`PUT ${sp.draft(testBusiness.id)}`]: putOk,
    });
    const { user } = renderApp(sitePath);
    await user.click(await screen.findByRole('button', { name: 'הסתרת המלצות' }));
    await user.click(screen.getByRole('button', { name: 'הזזת מחירון למעלה' }));
    await waitFor(
      () => expect(callsTo(fetchMock, 'PUT', sp.draft(testBusiness.id)).length).toBeGreaterThan(0),
      {
        timeout: 3000,
      },
    );
    const last = callsTo(fetchMock, 'PUT', sp.draft(testBusiness.id)).at(-1);
    expect(last.sections.map((s: { type: string }) => s.type).slice(0, 3)).toEqual([
      'hero',
      'pricing',
      'services',
    ]);
    expect(last.sections.find((s: { type: string }) => s.type === 'testimonials').visible).toBe(
      false,
    );
    await waitFor(() => expect(previewHtml()).not.toContain('מה הלקוחות מספרים'));
  });

  it('stops autosave and explains when another window saved first (409)', async () => {
    mockApi({
      [meKey]: me(testUser),
      ...getSite(site),
      [`PUT ${sp.draft(testBusiness.id)}`]: () =>
        apiError(409, 'CONFLICT', 'האתר נערך בינתיים בחלון אחר.'),
    });
    const { user } = renderApp(sitePath);
    await user.click(await screen.findByRole('button', { name: 'הסתרת המלצות' }));
    expect(
      await screen.findByText('האתר נערך בחלון אחר', {}, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'טעינה מחדש' })).toBeInTheDocument();
  });

  it('keeps a local backup when saving fails, and retries', async () => {
    let fail = true;
    const fetchMock = mockApi({
      [meKey]: me(testUser),
      ...getSite(site),
      [`PUT ${sp.draft(testBusiness.id)}`]: (body) =>
        fail ? apiError(500, 'INTERNAL_ERROR', 'שגיאה') : putOk(body),
    });
    const { user } = renderApp(sitePath);
    await user.click(await screen.findByRole('button', { name: 'הסתרת המלצות' }));
    expect(await screen.findByText('השמירה נכשלה', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(localStorage.getItem(`leadflow:site-draft:${testBusiness.id}`)).toContain(
      '"revision":0',
    );

    fail = false;
    await user.click(screen.getByRole('button', { name: 'נסו שוב' }));
    expect(await screen.findByText('כל השינויים נשמרו')).toBeInTheDocument();
    expect(localStorage.getItem(`leadflow:site-draft:${testBusiness.id}`)).toBeNull();
    expect(callsTo(fetchMock, 'PUT', sp.draft(testBusiness.id))).toHaveLength(2);
  });

  it('is read-only for non-owners (preview only)', async () => {
    mockApi({ [meKey]: me(testUser), ...asRole('MANAGER'), ...getSite(site) });
    renderApp(sitePath);
    expect(await screen.findByText(/רק בעל\/ת העסק יכול\/ה לערוך את האתר/)).toBeInTheDocument();
    expect(screen.queryByRole('tablist', { name: 'עריכת האתר' })).not.toBeInTheDocument();
    expect(previewHtml()).toContain('מספרת שירן');
  });
});
