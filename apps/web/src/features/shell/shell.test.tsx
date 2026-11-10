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
    renderApp(home);
    await screen.findByRole('heading', { name: /(בוקר טוב|צהריים טובים|ערב טוב), דנה/ });
    const links = within(mainNav()).getAllByRole('link');
    // Sections not built yet stay out of the menu (D-131).
    expect(links.map((l) => l.textContent)).toEqual([
      'דשבורד',
      'האתר שלי',
      'לידים',
      'לקוחות',
      'שיחות',
      'אוטומציות',
      'משימות',
      'תורים',
      'הצעות מחיר',
      'דוחות',
      'צוות',
      'הגדרות וחיוב',
    ]);
    expect(within(mainNav()).getByRole('link', { name: 'דשבורד' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('groups the menu under topic labels, all open (D-131)', async () => {
    mockApi({ [meKey]: me(testUser) });
    renderApp(section('tasks'));
    await screen.findByRole('heading', { name: 'משימות', level: 1 });
    const operations = within(mainNav()).getByRole('list', { name: 'תפעול' });
    expect(within(operations).getByRole('link', { name: 'משימות' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(mainNav()).getByRole('list', { name: 'שיווק ומכירות' })).toBeVisible();
    expect(within(mainNav()).queryByRole('button')).not.toBeInTheDocument();
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
    const bar = await screen.findByRole('progressbar', { name: 'התקדמות ההקמה' });
    expect(bar).toHaveAttribute('aria-valuenow', '1');
    expect(bar).toHaveAttribute('aria-valuemax', '5');
  });

  it('marks the email step done once verified', async () => {
    mockApi({ [meKey]: me({ ...testUser, emailVerified: true }) });
    renderApp(home);
    const bar = await screen.findByRole('progressbar', { name: 'התקדמות ההקמה' });
    expect(bar).toHaveAttribute('aria-valuenow', '2');
    expect(bar).toHaveAttribute('aria-valuemax', '5');
  });

  it('asks for no verification while the server sends no email (D-122)', async () => {
    mockApi({ [meKey]: () => json(200, { user: testUser, emailVerification: false }) });
    renderApp(home);
    const bar = await screen.findByRole('progressbar', { name: 'התקדמות ההקמה' });
    expect(bar).toHaveAttribute('aria-valuenow', '1');
    expect(bar).toHaveAttribute('aria-valuemax', '4');
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
  const todayIso = (h: number) => {
    const d = new Date();
    d.setHours(h, 59, 0, 0);
    return d.toISOString();
  };
  it('shows only what needs you today, each box opening its page (D-131)', async () => {
    mockApi({
      [meKey]: me(testUser),
      [`GET ${apiPaths.leads.list(testBusiness.id)}`]: () => json(200, { leads: [someLead] }),
    });
    renderApp(home);
    const today = await screen.findByRole('region', { name: 'מה מחכה לכם היום' });
    const leads = within(today).getByRole('link', { name: /פניות פתוחות/ });
    expect(leads).toHaveAttribute('href', `/b/${testBusiness.id}/leads`);
    await waitFor(() => expect(leads).toHaveTextContent('1'));
    expect(leads).toHaveTextContent('1 חדשות השבוע');
    expect(
      within(today)
        .getAllByRole('link')
        .map((l) => l.getAttribute('href')?.split('/').pop()),
    ).toEqual(['leads', 'appointments', 'tasks', 'conversations']);
    // No box per section any more: those live in the menu.
    expect(within(today).queryByRole('link', { name: /האתר שלי|הגדרות/ })).not.toBeInTheDocument();
  });

  it("names today's next appointment", async () => {
    mockApi({
      [meKey]: me(testUser),
      [`GET ${apiPaths.appointments.list(testBusiness.id)}`]: () =>
        json(200, {
          appointments: [
            { id: 'a1', startsAt: todayIso(23), status: 'CONFIRMED' },
            { id: 'a2', startsAt: todayIso(0), status: 'CANCELLED' },
          ],
        }),
    });
    renderApp(home);
    const box = await screen.findByRole('link', { name: /תורים היום/ });
    await waitFor(() => expect(box).toHaveTextContent(/^1/));
    expect(box).toHaveTextContent(/הבא ב-23:59/);
  });

  it('says when nothing is waiting', async () => {
    mockApi({ [meKey]: me(testUser) });
    renderApp(home);
    expect(await screen.findByText(/הכול מטופל/)).toBeInTheDocument();
  });

  it("an employee's today has no WhatsApp box", async () => {
    mockApi({ [meKey]: me(testUser), ...asRole('EMPLOYEE') });
    renderApp(home);
    const today = await screen.findByRole('region', { name: 'מה מחכה לכם היום' });
    expect(within(today).getAllByRole('link')).toHaveLength(3);
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
        language: 'he',
      },
    ]);
  });

  it('shows the Hebrew validation error and does not save invalid hours', async () => {
    const fetchMock = mockApi({ [meKey]: me(testUser) });
    const { user } = renderApp(section('settings'));
    // Settings come in tabs (D-141).
    await user.click(await screen.findByRole('tab', { name: 'שעות פעילות' }));
    const close = await screen.findByLabelText('שעת סגירה ביום שני');
    await user.clear(close);
    await user.type(close, '07:00');
    await user.click(screen.getByRole('button', { name: 'שמירת השעות' }));
    expect(await screen.findByText('שעת הסגירה צריכה להיות אחרי שעת הפתיחה')).toBeInTheDocument();
    expect(callsTo(fetchMock, 'PATCH', bp.detail(testBusiness.id))).toHaveLength(0);
  });
});
