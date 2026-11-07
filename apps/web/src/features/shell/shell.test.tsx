import { apiPaths, businessWebPaths, type Business, type Lead } from '@leadflow/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  callsTo,
  json,
  me,
  mockApi,
  renderApp,
  testBusiness,
  testStages,
  testUser,
} from '../../test/utils';

afterEach(() => vi.unstubAllGlobals());

const bp = apiPaths.businesses;
const meKey = `GET ${apiPaths.auth.me}`;
const home = businessWebPaths.home(testBusiness.id);
const section = (s: string) => businessWebPaths.section(testBusiness.id, s);
const asRole = (role: Business['role']) => ({
  [`GET ${bp.detail(testBusiness.id)}`]: () => json(200, { business: { ...testBusiness, role } }),
});
/** The always-rendered desktop sidebar (the drawer adds a second one only when open). */
const mainNav = () => screen.getAllByRole('navigation', { name: 'ניווט ראשי' })[0]!;

describe('app shell', () => {
  it('shows the full navigation in the UX-spec order and marks the current page', async () => {
    mockApi({ [meKey]: me(testUser) });
    const { user } = renderApp(home);
    await screen.findByRole('heading', { name: /(בוקר טוב|צהריים טובים|ערב טוב), דנה/ });
    // Topics start closed on the dashboard (D-125); open them all.
    for (const topic of ['שיווק ומכירות', 'תפעול', 'ניהול']) {
      await user.click(within(mainNav()).getByRole('button', { name: new RegExp(topic) }));
    }
    const links = within(mainNav()).getAllByRole('link');
    expect(links.map((l) => l.textContent?.replace(/\(?בקרוב\)?/g, '').trim())).toEqual([
      'דשבורד',
      'האתר שלי',
      'לקוחות ולידים',
      'שיחות',
      'משימות',
      'תורים',
      'הצעות מחיר',
      'אוטומציות',
      'דוחות',
      'צוות',
      'הגדרות וחיוב',
    ]);
    expect(within(mainNav()).getByRole('link', { name: 'דשבורד' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it("menu topics open and close, the current page's topic opens itself, and it is remembered (D-125)", async () => {
    mockApi({ [meKey]: me(testUser) });
    const { user } = renderApp(section('tasks'));
    await screen.findByRole('heading', { name: 'משימות', level: 1 });
    const operations = within(mainNav()).getByRole('button', { name: /תפעול/ });
    expect(operations).toHaveAttribute('aria-expanded', 'true');
    expect(within(mainNav()).getByRole('link', { name: 'משימות' })).toBeVisible();
    const sales = within(mainNav()).getByRole('button', { name: /שיווק ומכירות/ });
    expect(sales).toHaveAttribute('aria-expanded', 'false');
    expect(within(mainNav()).queryByRole('link', { name: 'האתר שלי' })).not.toBeInTheDocument();
    await user.click(sales);
    expect(within(mainNav()).getByRole('link', { name: 'האתר שלי' })).toBeVisible();
    expect(JSON.parse(localStorage.getItem('leadflow.nav.open')!)).toContain('sales');
    await user.click(operations);
    expect(operations).toHaveAttribute('aria-expanded', 'false');
  });

  it('renders a "coming soon" page for sections that are not built yet', async () => {
    mockApi({ [meKey]: me(testUser) });
    renderApp(section('automations'));
    expect(await screen.findByRole('heading', { name: 'אוטומציות בדרך' })).toBeInTheDocument();
    expect(within(mainNav()).getByRole('link', { name: /אוטומציות/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('shows a not-found state for an unknown section', async () => {
    mockApi({ [meKey]: me(testUser) });
    renderApp(section('nope'));
    expect(await screen.findByRole('heading', { name: 'העמוד לא נמצא' })).toBeInTheDocument();
  });

  it('opens the mobile menu as a dialog and closes it after navigating', async () => {
    mockApi({ [meKey]: me(testUser) });
    const { user, location } = renderApp(home);
    await user.click(await screen.findByRole('button', { name: 'פתיחת תפריט' }));
    const dialog = await screen.findByRole('dialog', { name: 'תפריט ניווט' });
    await user.click(within(dialog).getByRole('button', { name: /ניהול/ }));
    await user.click(within(dialog).getByRole('link', { name: 'הגדרות וחיוב' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(location()).toBe(section('settings'));
  });

  it('switches between businesses', async () => {
    const second: Business = {
      ...testBusiness,
      id: '9b8c7d6e-5f4a-4b3c-8d2e-1f0a9b8c7d6e',
      name: 'מוסך הצפון',
    };
    mockApi({
      [meKey]: me(testUser),
      [`GET ${bp.list}`]: () => json(200, { businesses: [testBusiness, second] }),
      [`GET ${bp.detail(second.id)}`]: () => json(200, { business: second }),
    });
    const { user, location } = renderApp(home);
    const switcher = (await screen.findAllByLabelText('העסק הנוכחי'))[0]!;
    await user.selectOptions(switcher, second.id);
    await waitFor(() => expect(location()).toBe(businessWebPaths.home(second.id)));
    // The name sits in its own <bdi>, so match the whole line.
    expect(
      await screen.findByText(
        (_, el) => el?.tagName === 'P' && /^מוסך הצפון · /.test(el.textContent ?? ''),
      ),
    ).toBeInTheDocument();
  });
});

describe('dashboard', () => {
  it('counts only real progress: profile done, email not yet verified, the rest "soon"', async () => {
    mockApi({ [meKey]: me(testUser) });
    renderApp(home);
    expect(await screen.findByText('הושלמו 1 מתוך 5')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'התקדמות ההקמה' })).toHaveAttribute(
      'aria-valuenow',
      '1',
    );
    expect(screen.getByText('עדיין אין פניות')).toBeInTheDocument();
  });

  it('marks the email step done once verified', async () => {
    mockApi({ [meKey]: me({ ...testUser, emailVerified: true }) });
    renderApp(home);
    expect(await screen.findByText('הושלמו 2 מתוך 5')).toBeInTheDocument();
  });

  it('asks for no verification while the server sends no email (D-122)', async () => {
    mockApi({ [meKey]: () => json(200, { user: testUser, emailVerification: false }) });
    renderApp(home);
    expect(await screen.findByText('הושלמו 1 מתוך 4')).toBeInTheDocument();
    expect(screen.queryByText('אימות כתובת האימייל')).not.toBeInTheDocument();
    expect(screen.queryByText(/כדאי לאמת את כתובת האימייל/)).not.toBeInTheDocument();
  });

  const someLead: Lead = {
    id: '5c000000-0000-4000-8000-000000000001',
    contact: {
      id: '5d000000-0000-4000-8000-000000000001',
      name: 'רון',
      phone: null,
      email: 'r@example.com',
    },
    stage: { id: testStages[0]!.id, name: testStages[0]!.name, kind: 'OPEN' },
    source: 'manual',
    sourceUrl: null,
    message: null,
    owner: null,
    expectedValue: null,
    nextActionAt: null,
    tags: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const weekReport = {
    range: { from: '2026-10-21T00:00:00.000Z', to: '2026-10-28T00:00:00.000Z', days: 7 },
    leads: { current: 4, previous: 6 },
    closeRate: 0.5,
    wonValue: 0,
    openValue: 0,
    avgResponseMinutes: 30,
    respondedLeads: 3,
    series: { unit: 'day', points: [] },
    byStage: [],
    bySource: [],
  };

  it('shows the week in numbers to owners and managers once there are leads', async () => {
    const fetchMock = mockApi({
      [meKey]: me(testUser),
      [`GET ${apiPaths.leads.list(testBusiness.id)}`]: () => json(200, { leads: [someLead] }),
      [`GET ${apiPaths.reports.summary(testBusiness.id)}`]: () => json(200, weekReport),
    });
    renderApp(home);
    const stats = await screen.findByRole('region', { name: 'השבוע במספרים' });
    expect(within(stats).getByText('−2 לעומת השבוע שלפני')).toBeInTheDocument();
    expect(within(stats).getByText('50%')).toBeInTheDocument();
    expect(within(stats).getByText('30 דק׳')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('/reports/summary?days=7'))).toBe(
      true,
    );
  });

  it('employees do not get the week in numbers', async () => {
    mockApi({
      [meKey]: me(testUser),
      ...asRole('EMPLOYEE'),
      [`GET ${apiPaths.leads.list(testBusiness.id)}`]: () => json(200, { leads: [someLead] }),
    });
    renderApp(home);
    await screen.findByRole('list', { name: 'פניות אחרונות' });
    expect(screen.queryByRole('region', { name: 'השבוע במספרים' })).not.toBeInTheDocument();
  });

  it('shows a box for every section, in the sidebar groups, with live counts (D-124)', async () => {
    mockApi({
      [meKey]: me(testUser),
      [`GET ${apiPaths.leads.list(testBusiness.id)}`]: () => json(200, { leads: [someLead] }),
    });
    renderApp(home);
    const sales = await screen.findByRole('region', { name: 'שיווק ומכירות' });
    expect(within(sales).getByRole('link', { name: /לקוחות ולידים/ })).toHaveAttribute(
      'href',
      `/b/${testBusiness.id}/leads`,
    );
    expect(await within(sales).findByText('1 פתוחות')).toBeInTheDocument();
    expect(within(sales).getByText('עוד לא נבנה')).toBeInTheDocument();
    const operations = screen.getByRole('region', { name: 'תפעול' });
    expect(
      within(operations)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual([
      expect.stringContaining('משימות'),
      expect.stringContaining('תורים'),
      expect.stringContaining('הצעות מחיר'),
      expect.stringContaining('אוטומציות'),
    ]);
    expect(screen.getByRole('region', { name: 'ניהול' })).toBeInTheDocument();
  });

  it("an employee's boxes are only the sections they can open", async () => {
    mockApi({ [meKey]: me(testUser), ...asRole('EMPLOYEE') });
    renderApp(home);
    const management = await screen.findByRole('region', { name: 'ניהול' });
    expect(within(management).queryByRole('link', { name: /צוות/ })).not.toBeInTheDocument();
    expect(within(management).queryByRole('link', { name: /דוחות/ })).not.toBeInTheDocument();
  });
});

describe('roles in the shell', () => {
  it('an employee does not see the Team link and gets a no-permission state on /team', async () => {
    const fetchMock = mockApi({ [meKey]: me(testUser), ...asRole('EMPLOYEE') });
    renderApp(section('team'));
    expect(
      await screen.findByRole('heading', { name: 'אין לך הרשאה לצפות ברשימת הצוות' }),
    ).toBeInTheDocument();
    expect(within(mainNav()).queryByRole('link', { name: 'צוות' })).not.toBeInTheDocument();
    expect(callsTo(fetchMock, 'GET', bp.members(testBusiness.id))).toHaveLength(0);
  });

  it('a manager sees the team list with roles', async () => {
    mockApi({
      [meKey]: me(testUser),
      ...asRole('MANAGER'),
      [`GET ${bp.members(testBusiness.id)}`]: () =>
        json(200, {
          members: [
            {
              userId: testUser.id,
              fullName: 'שירן לוי',
              email: 'owner@example.com',
              role: 'OWNER',
              joinedAt: testUser.createdAt,
            },
            {
              userId: '1d2e3f4a-5b6c-4d7e-8f9a-0b1c2d3e4f5a',
              fullName: 'דנה כהן',
              email: 'dana@example.com',
              role: 'MANAGER',
              joinedAt: testUser.createdAt,
            },
          ],
        }),
    });
    renderApp(section('team'));
    const list = await screen.findByRole('list', { name: 'חברי הצוות' });
    expect(within(list).getByText('שירן לוי')).toBeInTheDocument();
    expect(within(list).getByText('בעל/ת העסק')).toBeInTheDocument();
    expect(within(list).getByText('owner@example.com')).toHaveAttribute('dir', 'ltr');
  });

  it('settings are read-only for a non-owner (no save buttons)', async () => {
    mockApi({ [meKey]: me(testUser), ...asRole('MANAGER') });
    renderApp(section('settings'));
    expect(await screen.findByText(/רק בעל\/ת העסק יכול\/ה לשנות את ההגדרות/)).toBeInTheDocument();
    expect(screen.getByLabelText(/שם העסק/)).toBeDisabled();
    expect(screen.queryByRole('button', { name: /שמירת/ })).not.toBeInTheDocument();
  });
});

describe('settings', () => {
  it('saves business details with a normalised phone and confirms', async () => {
    const fetchMock = mockApi({
      [meKey]: me(testUser),
      [`PATCH ${bp.detail(testBusiness.id)}`]: (body) =>
        json(200, { business: { ...testBusiness, ...(body as object) } }),
    });
    const { user } = renderApp(section('settings'));
    const name = await screen.findByLabelText(/שם העסק/);
    await user.clear(name);
    await user.type(name, 'מספרת שירן ובנותיה');
    const phone = screen.getByLabelText(/טלפון העסק/);
    await user.clear(phone);
    await user.type(phone, '+972 52 765 4321');
    await user.click(screen.getByRole('button', { name: 'שמירת הפרטים' }));
    expect(await screen.findByText('השינויים נשמרו')).toBeInTheDocument();
    expect(callsTo(fetchMock, 'PATCH', bp.detail(testBusiness.id))).toEqual([
      {
        name: 'מספרת שירן ובנותיה',
        industry: 'beauty',
        phone: '+972527654321',
        address: 'הרצל 10, חיפה',
      },
    ]);
  });

  it('shows the Hebrew validation error and does not save invalid hours', async () => {
    const fetchMock = mockApi({ [meKey]: me(testUser) });
    const { user } = renderApp(section('settings'));
    const close = await screen.findByLabelText('שעת סגירה ביום שני');
    await user.clear(close);
    await user.type(close, '07:00');
    await user.click(screen.getByRole('button', { name: 'שמירת השעות' }));
    expect(await screen.findByText('שעת הסגירה צריכה להיות אחרי שעת הפתיחה')).toBeInTheDocument();
    expect(callsTo(fetchMock, 'PATCH', bp.detail(testBusiness.id))).toHaveLength(0);
  });
});
