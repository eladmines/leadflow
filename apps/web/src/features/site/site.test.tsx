import {
  apiPaths,
  buildTemplateDraft,
  businessWebPaths,
  type Business,
  type Site,
} from '@simplecatch/shared';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
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
import { setLocaleForTests } from '../../i18n';
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
  it('asks to choose between two separate cards, each with the way back (D-136)', async () => {
    mockApi({ [meKey]: me(testUser), ...getSite(null) });
    const { user } = renderApp(sitePath);
    const start = await screen.findByRole('region', { name: 'בחרו איך להתחיל' });
    await user.click(within(start).getByRole('button', { name: /בניית אתר חדש/ }));
    expect(screen.getAllByRole('article').length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: 'חזרה לבחירה' }));
    await user.click(await screen.findByRole('button', { name: /חיבור אתר קיים/ }));
    expect(screen.getByRole('heading', { name: 'מה הכתובת של האתר שלכם?' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'חזרה לבחירה' }));
    expect(await screen.findByRole('region', { name: 'בחרו איך להתחיל' })).toBeInTheDocument();
  });

  it('suggests the template for the industry and creates the site', async () => {
    const fetchMock = mockApi({
      [meKey]: me(testUser),
      ...getSite(null),
      [`POST ${sp.site(testBusiness.id)}`]: () => json(201, { site }),
    });
    const { user } = renderApp(sitePath);
    // First the two cards (D-136): build a new website, or link the existing one.
    await user.click(await screen.findByRole('button', { name: /בניית אתר חדש/ }));
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

  it('an English business gets English templates (D-142, D-143)', async () => {
    setLocaleForTests('en');
    try {
      const fetchMock = mockApi({
        [meKey]: me(testUser),
        [`GET ${apiPaths.businesses.detail(testBusiness.id)}`]: () =>
          json(200, { business: { ...testBusiness, language: 'en' } }),
        ...getSite(null),
        [`POST ${sp.site(testBusiness.id)}`]: () => json(201, { site }),
      });
      const { user } = renderApp(sitePath);
      await user.click(await screen.findByRole('button', { name: /Build a new website/ }));
      const cards = await screen.findAllByRole('article');
      const preview = cards[0]!.querySelector('iframe')!.getAttribute('srcdoc')!;
      expect(preview).toContain('<html lang="en" dir="ltr">');
      expect(preview).toContain('Book an appointment');
      expect(preview).not.toContain('לקביעת תור');
      await user.click(within(cards[0]!).getByRole('button', { name: 'Choose template' }));
      await waitFor(() =>
        expect(callsTo(fetchMock, 'POST', sp.site(testBusiness.id))).toEqual([
          { templateKey: 'beauty' },
        ]),
      );
    } finally {
      setLocaleForTests('he');
    }
  });

  it('non-owners see an empty state instead of the picker', async () => {
    mockApi({ [meKey]: me(testUser), ...asRole('EMPLOYEE'), ...getSite(null) });
    renderApp(sitePath);
    expect(await screen.findByRole('heading', { name: 'האתר עדיין לא נבנה' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'בחירת התבנית' })).not.toBeInTheDocument();
  });
});

describe('existing website (D-094)', () => {
  const withWebsite = (role: Business['role'] = 'OWNER') => ({
    [`GET ${apiPaths.businesses.detail(testBusiness.id)}`]: () =>
      json(200, { business: { ...testBusiness, role, websiteUrl: 'https://www.shiran.co.il' } }),
  });

  it('explains the visit counter in two short steps; the per-builder steps are hidden for now (F31)', async () => {
    const snippet =
      '<script async src="https://app.example/api/v1/embed/sc.js" data-key="K"></script>';
    mockApi({
      [meKey]: me(testUser),
      ...withWebsite(),
      ...getSite(null),
      [`GET ${apiPaths.embed.info(testBusiness.id)}`]: () =>
        json(200, { scriptUrl: 'https://app.example/api/v1/embed/sc.js', key: 'K', snippet }),
    });
    renderApp(sitePath);
    expect(
      await screen.findByText(/העתיקו את השורה הזו, והדביקו אותה באתר בכל הדפים, לפני התגית/),
    ).toBeInTheDocument();
    expect(screen.getByText(snippet)).toBeInTheDocument();
    expect(screen.getByText(/בדקו שזה עובד/)).toBeInTheDocument();
    // Wix, WordPress, Shopify and "other" steps are commented out for now.
    expect(screen.queryByRole('tab', { name: 'WordPress' })).not.toBeInTheDocument();
    expect(screen.queryByText(/WPCode/)).not.toBeInTheDocument();
    expect(screen.queryByText(/theme\.liquid/)).not.toBeInTheDocument();
    // Named buttons, sections and ad tags are hidden too; forms have a card of their own.
    expect(screen.queryByText('אפשרויות נוספות (לא חובה)')).not.toBeInTheDocument();
    expect(screen.queryByText(/data-sc-click=/)).not.toBeInTheDocument();
  });

  it("explains in three short steps how the website's own form becomes leads (F30)", async () => {
    mockApi({
      [meKey]: me(testUser),
      ...withWebsite(),
      ...getSite(null),
      [`GET ${apiPaths.embed.info(testBusiness.id)}`]: () =>
        json(200, {
          scriptUrl: 'https://app.example/api/v1/embed/sc.js',
          key: 'K',
          snippet:
            '<script async src="https://app.example/api/v1/embed/sc.js" data-key="K"></script>',
        }),
      [`GET ${apiPaths.domain.domain(testBusiness.id)}`]: () =>
        json(200, {
          domain: 'shiran.co.il',
          check: 'unsupported',
          expiresAt: null,
          checkedAt: null,
          daysLeft: null,
          checking: false,
        }),
    });
    const { user } = renderApp(sitePath);
    expect(await screen.findByRole('heading', { name: 'לידים מהטופס שלכם' })).toBeInTheDocument();
    // One attribute on the script line; no restrictions listed beyond a name and a phone.
    // A form's id, and the line ready to copy: the user's own line with data-forms added at the end.
    expect(await screen.findByText('<form id="contact-form"> … </form>')).toBeInTheDocument();
    expect(
      screen.getByText(
        '<script async src="https://app.example/api/v1/embed/sc.js" data-key="K" data-forms="#contact-form"></script>',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/בטופס צריך לפחות שם וטלפון/)).toBeInTheDocument();
    expect(screen.queryByText(/data-copy/)).not.toBeInTheDocument();
    expect(screen.queryByText(/תיבת אישור/)).not.toBeInTheDocument();
    // The Shopify line is hidden for now.
    expect(screen.queryByText(/data-forms="form\[action/)).not.toBeInTheDocument();
    expect(screen.queryByText(/ב-Shopify/)).not.toBeInTheDocument();
    // The link continues the sentence: "…מופיעה בדף הלידים.", all in one line.
    expect(screen.getByRole('link', { name: 'דף הלידים' }).parentElement).toHaveTextContent(
      'שלחו פנייה לדוגמה מהאתר, ובדקו שהיא מופיעה בדף הלידים.',
    );
    expect(screen.getByRole('link', { name: 'דף הלידים' })).toHaveAttribute(
      'href',
      `/b/${testBusiness.id}/leads`,
    );
    // It folds away like the others.
    await user.click(screen.getByRole('button', { name: 'הסתרה: לידים מהטופס שלכם' }));
    expect(screen.queryByText('<form id="contact-form"> … </form>')).not.toBeInTheDocument();
  });

  it('the preview and the visit-counter guide can be folded away, and stay that way (F33)', async () => {
    // Only the fold marks (clearing everything would bring the first-visit tour back).
    const forget = () =>
      Object.keys(localStorage)
        .filter((k) => k.startsWith('simplecatch.collapsed.'))
        .forEach((k) => localStorage.removeItem(k));
    forget();
    const mocks = () =>
      mockApi({
        [meKey]: me(testUser),
        ...withWebsite(),
        ...getSite(null),
        [`GET ${apiPaths.embed.info(testBusiness.id)}`]: () =>
          json(200, {
            scriptUrl: 'https://app.example/api/v1/embed/sc.js',
            key: 'K',
            snippet: '<script async></script>',
          }),
        [`GET ${apiPaths.domain.domain(testBusiness.id)}`]: () =>
          json(200, {
            domain: 'shiran.co.il',
            check: 'unsupported',
            expiresAt: null,
            checkedAt: null,
            daysLeft: null,
            checking: false,
          }),
      });
    mocks();
    const { user } = renderApp(sitePath);
    expect(await screen.findByTitle('תצוגה של האתר הקיים')).toBeInTheDocument();
    expect(await screen.findByText(/העתיקו את השורה הזו, והדביקו אותה באתר/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'הסתרה: תצוגת האתר' }));
    expect(screen.queryByTitle('תצוגה של האתר הקיים')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'הסתרה: קבלת פניות והמקור שלהן מהאתר' }));
    expect(screen.queryByText(/העתיקו את השורה הזו, והדביקו אותה באתר/)).not.toBeInTheDocument();
    // The title stays, and the button says it is folded.
    expect(
      screen.getByRole('heading', { name: 'קבלת פניות והמקור שלהן מהאתר' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'הצגה: תצוגת האתר' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );

    // Opening the screen again (a reload) keeps both folded; showing brings one back.
    cleanup();
    mocks();
    const second = renderApp(sitePath);
    expect(await screen.findByRole('button', { name: 'הצגה: תצוגת האתר' })).toBeInTheDocument();
    expect(screen.queryByTitle('תצוגה של האתר הקיים')).not.toBeInTheDocument();
    expect(screen.queryByText(/העתיקו את השורה הזו, והדביקו אותה באתר/)).not.toBeInTheDocument();
    await second.user.click(screen.getByRole('button', { name: 'הצגה: תצוגת האתר' }));
    expect(await screen.findByTitle('תצוגה של האתר הקיים')).toBeInTheDocument();
    forget();
  });

  it('shows when the domain expires, warns when it is close, and the owner can check now (F33)', async () => {
    const soon = new Date(Date.now() + 20 * 86_400_000).toISOString();
    let checked = 0;
    mockApi({
      [meKey]: me(testUser),
      ...withWebsite(),
      ...getSite(null),
      [`GET ${apiPaths.embed.info(testBusiness.id)}`]: () =>
        json(200, {
          scriptUrl: 'https://app.example/api/v1/embed/sc.js',
          key: 'K',
          snippet: '<script></script>',
        }),
      [`GET ${apiPaths.domain.domain(testBusiness.id)}`]: () =>
        json(200, {
          domain: 'shiran.co.il',
          check: 'ok',
          expiresAt: soon,
          checkedAt: soon,
          daysLeft: 20,
        }),
      [`POST ${apiPaths.domain.domain(testBusiness.id)}`]: () => {
        checked += 1;
        return json(200, {
          domain: 'shiran.co.il',
          check: 'ok',
          expiresAt: soon,
          checkedAt: soon,
          daysLeft: 19,
          checking: false,
        });
      },
    });
    const { user } = renderApp(sitePath);
    const line = await screen.findByText(/הדומיין shiran\.co\.il פג ב-.*בעוד 20 ימים/);
    // Under 30 days: the warning colour.
    expect(line.closest('div')).toHaveClass('bg-danger-50');
    await user.click(screen.getByRole('button', { name: 'בדיקה עכשיו' }));
    expect(await screen.findByText(/בעוד 19 ימים/)).toBeInTheDocument();
    expect(checked).toBe(1);
  });

  it('finds the domain date by itself when the screen opens: no button to press (F33)', async () => {
    const soon = new Date(Date.now() + 90 * 86_400_000).toISOString();
    let asked = 0;
    mockApi({
      [meKey]: me(testUser),
      ...withWebsite(),
      ...getSite(null),
      [`GET ${apiPaths.embed.info(testBusiness.id)}`]: () =>
        json(200, {
          scriptUrl: 'https://app.example/api/v1/embed/sc.js',
          key: 'K',
          snippet: '<script></script>',
        }),
      [`GET ${apiPaths.domain.domain(testBusiness.id)}`]: () => {
        asked += 1;
        return asked === 1
          ? json(200, {
              domain: 'shiran.co.il',
              check: null,
              expiresAt: null,
              checkedAt: null,
              daysLeft: null,
              checking: true,
            })
          : json(200, {
              domain: 'shiran.co.il',
              check: 'ok',
              expiresAt: soon,
              checkedAt: soon,
              daysLeft: 90,
              checking: false,
            });
      },
    });
    renderApp(sitePath);
    expect(await screen.findByText('בודקים מתי shiran.co.il פג…')).toBeInTheDocument();
    expect(
      await screen.findByText(/בעוד 90 ימים/, undefined, { timeout: 4000 }),
    ).toBeInTheDocument();
    expect(asked).toBe(2);
  });

  it('says plainly when the domain can not be read, and hides the button from non-owners (F33)', async () => {
    mockApi({
      [meKey]: me(testUser),
      ...withWebsite('EMPLOYEE'),
      ...getSite(null),
      [`GET ${apiPaths.domain.domain(testBusiness.id)}`]: () =>
        json(200, {
          domain: 'shiran.xyz',
          check: 'unsupported',
          expiresAt: null,
          checkedAt: null,
          daysLeft: null,
        }),
    });
    renderApp(sitePath);
    expect(
      await screen.findByText(/לא ניתן לקרוא אוטומטית את תאריך הפקיעה של shiran\.xyz/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'בדיקה עכשיו' })).not.toBeInTheDocument();
  });

  it('the owner adds the address from the picker page', async () => {
    const fetchMock = mockApi({
      [meKey]: me(testUser),
      ...getSite(null),
      [`PATCH ${apiPaths.businesses.detail(testBusiness.id)}`]: () =>
        json(200, { business: { ...testBusiness, websiteUrl: 'https://www.shiran.co.il' } }),
    });
    const { user } = renderApp(sitePath);
    await user.click(await screen.findByRole('button', { name: /חיבור אתר קיים/ }));
    expect(screen.getByRole('heading', { name: 'מה הכתובת של האתר שלכם?' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('כתובת האתר הקיים'), 'shiran');
    await user.click(screen.getByRole('button', { name: 'שמירה' }));
    expect(await screen.findByText(/כתובת האתר אינה תקינה/)).toBeInTheDocument();

    await user.clear(screen.getByLabelText('כתובת האתר הקיים'));
    await user.type(screen.getByLabelText('כתובת האתר הקיים'), 'www.shiran.co.il');
    await user.click(screen.getByRole('button', { name: 'שמירה' }));
    await waitFor(() =>
      expect(callsTo(fetchMock, 'PATCH', apiPaths.businesses.detail(testBusiness.id))).toEqual([
        { websiteUrl: 'https://www.shiran.co.il' },
      ]),
    );
    expect(await screen.findByRole('heading', { name: 'האתר הקיים של העסק' })).toBeInTheDocument();
  });

  it('shows the site with a "not managed by SimpleCatch" note, and no templates', async () => {
    mockApi({ [meKey]: me(testUser), ...withWebsite(), ...getSite(null) });
    renderApp(sitePath);
    expect(await screen.findByRole('heading', { name: 'האתר הקיים של העסק' })).toBeInTheDocument();
    expect(screen.getByText('לא מנוהל ב-SimpleCatch')).toBeInTheDocument();
    expect(screen.getByText(/לא נבנה ב-SimpleCatch ולא מנוהל כאן/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /www\.shiran\.co\.il/ })).toHaveAttribute(
      'href',
      'https://www.shiran.co.il',
    );
    expect(screen.getByTitle('תצוגה של האתר הקיים')).toHaveAttribute(
      'src',
      'https://www.shiran.co.il',
    );
    // Linking an existing site means no templates here; removing the address brings them back.
    expect(screen.queryByRole('button', { name: 'בחירת התבנית' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'בניית אתר חדש ב-SimpleCatch' }),
    ).not.toBeInTheDocument();
  });

  it('the owner removes the address only after confirming', async () => {
    const fetchMock = mockApi({
      [meKey]: me(testUser),
      ...withWebsite(),
      ...getSite(null),
      [`PATCH ${apiPaths.businesses.detail(testBusiness.id)}`]: () =>
        json(200, { business: testBusiness }),
    });
    const { user } = renderApp(sitePath);
    await user.click(await screen.findByRole('button', { name: 'הסרת האתר מהמערכת' }));
    // A pop-up asks first; cancelling changes nothing.
    const dialog = await screen.findByRole('dialog', { name: 'להסיר את האתר מהמערכת?' });
    await user.click(within(dialog).getByRole('button', { name: 'ביטול' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(callsTo(fetchMock, 'PATCH', apiPaths.businesses.detail(testBusiness.id))).toHaveLength(
      0,
    );

    await user.click(screen.getByRole('button', { name: 'הסרת האתר מהמערכת' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'כן, להסיר' }),
    );
    await waitFor(() =>
      expect(callsTo(fetchMock, 'PATCH', apiPaths.businesses.detail(testBusiness.id))).toEqual([
        { websiteUrl: null },
      ]),
    );
  });

  it('non-owners can view it but not change it', async () => {
    mockApi({ [meKey]: me(testUser), ...withWebsite('EMPLOYEE'), ...getSite(null) });
    renderApp(sitePath);
    expect(await screen.findByRole('heading', { name: 'האתר הקיים של העסק' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'שינוי הכתובת' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'בחירת התבנית' })).not.toBeInTheDocument();
  });
});

describe('site editor', () => {
  it('a blank page needs only a name; the address can be edited', async () => {
    const fetchMock = mockApi({
      [meKey]: me(testUser),
      ...getSite(site),
      [`PUT ${sp.draft(testBusiness.id)}`]: putOk,
    });
    const { user } = renderApp(sitePath);
    await user.click(await screen.findByRole('button', { name: 'עמוד חדש' }));
    const dialog = await screen.findByRole('dialog', { name: 'עמוד חדש' });
    expect(within(dialog).getByRole('button', { name: 'הוספת העמוד' })).toBeDisabled();
    await user.type(within(dialog).getByLabelText('שם העמוד'), 'המבצע שלנו');
    await user.clear(within(dialog).getByLabelText('כתובת העמוד'));
    await user.type(within(dialog).getByLabelText('כתובת העמוד'), 'summer sale');
    await user.click(within(dialog).getByRole('button', { name: 'הוספת העמוד' }));
    expect(screen.getByRole('tab', { name: 'המבצע שלנו' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await waitFor(
      () =>
        expect(callsTo(fetchMock, 'PUT', sp.draft(testBusiness.id)).at(-1)?.pages[0]).toMatchObject(
          { title: 'המבצע שלנו', slug: 'summer-sale', inMenu: true, sections: [] },
        ),
      { timeout: 3000 },
    );
  });

  it('a new landing page says it is not in the menu and can be added with one click', async () => {
    const fetchMock = mockApi({
      [meKey]: me(testUser),
      ...getSite(site),
      [`PUT ${sp.draft(testBusiness.id)}`]: putOk,
    });
    const { user } = renderApp(sitePath);
    await user.click(await screen.findByRole('button', { name: 'עמוד חדש' }));
    const addDialog = await screen.findByRole('dialog', { name: 'עמוד חדש' });
    await user.selectOptions(within(addDialog).getByLabelText('תוכן התחלתי (לא חובה)'), 'landing');
    expect(
      within(addDialog).getByRole('checkbox', { name: 'להציג בתפריט האתר' }),
    ).not.toBeChecked();
    await user.click(within(addDialog).getByRole('button', { name: 'הוספת העמוד' }));
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
    await user.selectOptions(within(dialog).getByLabelText('תוכן התחלתי (לא חובה)'), 'about');
    expect(within(dialog).getByLabelText('שם העמוד')).toHaveValue('אודות');
    expect(within(dialog).getByLabelText('כתובת העמוד')).toHaveValue('about');
    await user.click(within(dialog).getByRole('button', { name: 'הוספת העמוד' }));
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
    expect(localStorage.getItem(`simplecatch:site-draft:${testBusiness.id}`)).toContain(
      '"revision":0',
    );

    fail = false;
    await user.click(screen.getByRole('button', { name: 'נסו שוב' }));
    expect(await screen.findByText('כל השינויים נשמרו')).toBeInTheDocument();
    expect(localStorage.getItem(`simplecatch:site-draft:${testBusiness.id}`)).toBeNull();
    expect(callsTo(fetchMock, 'PUT', sp.draft(testBusiness.id))).toHaveLength(2);
  });

  it('switches to another template after confirming, and reloads the editor (D-095)', async () => {
    const garage = {
      ...site,
      ...buildTemplateDraft('garage', siteBusinessInfo(testBusiness)),
      pages: [],
      revision: 1,
    };
    const fetchMock = mockApi({
      [meKey]: me(testUser),
      ...getSite(site),
      [`POST ${sp.template(testBusiness.id)}`]: () => json(200, { site: garage }),
    });
    const { user } = renderApp(sitePath);
    await user.click(await screen.findByRole('button', { name: 'אפשרויות' }));
    const dialog = await screen.findByRole('dialog', { name: 'אפשרויות האתר' });
    expect(within(dialog).getByText('התבנית הנוכחית')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: /מוסכים ורכב/ }));
    expect(within(dialog).getByText(/עמוד הבית יוחלף בתבנית "מוסכים ורכב"/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'החלפת התבנית' }));
    await waitFor(() =>
      expect(callsTo(fetchMock, 'POST', sp.template(testBusiness.id))).toEqual([
        { templateKey: 'garage', revision: 0 },
      ]),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    // The editor now shows the garage content.
    await waitFor(() => expect(previewHtml()).toContain('הכנה לטסט'));
  });

  it('deletes the site after an explicit confirmation and falls back to the existing website (D-095)', async () => {
    let deleted = false;
    const fetchMock = mockApi({
      [meKey]: me(testUser),
      [`GET ${apiPaths.businesses.detail(testBusiness.id)}`]: () =>
        json(200, { business: { ...testBusiness, websiteUrl: 'https://www.shiran.co.il' } }),
      [`GET ${sp.site(testBusiness.id)}`]: () => json(200, { site: deleted ? null : site }),
      [`DELETE ${sp.site(testBusiness.id)}`]: () => {
        deleted = true;
        return new Response(null, { status: 204 });
      },
    });
    const { user } = renderApp(sitePath);
    await user.click(await screen.findByRole('button', { name: 'אפשרויות' }));
    const dialog = await screen.findByRole('dialog', { name: 'אפשרויות האתר' });
    await user.click(within(dialog).getByRole('button', { name: 'מחיקת האתר…' }));
    const confirm = within(dialog).getByRole('button', { name: 'מחיקה סופית' });
    expect(confirm).toBeDisabled();
    await user.click(within(dialog).getByLabelText('הבנתי שאי אפשר לשחזר את האתר אחרי המחיקה'));
    await user.click(confirm);
    await waitFor(() =>
      expect(callsTo(fetchMock, 'DELETE', sp.site(testBusiness.id))).toHaveLength(1),
    );
    expect(await screen.findByRole('heading', { name: 'האתר הקיים של העסק' })).toBeInTheDocument();
  });

  it('is read-only for non-owners (preview only)', async () => {
    mockApi({ [meKey]: me(testUser), ...asRole('MANAGER'), ...getSite(site) });
    renderApp(sitePath);
    expect(await screen.findByText(/רק בעל\/ת העסק יכול\/ה לערוך את האתר/)).toBeInTheDocument();
    expect(screen.queryByRole('tablist', { name: 'עריכת האתר' })).not.toBeInTheDocument();
    expect(previewHtml()).toContain('מספרת שירן');
  });
});
