import { apiPaths, businessWebPaths, type ReportSummary } from '@simplecatch/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { shekel } from '../leads/api';
import { json, me, mockApi, renderApp, testBusiness, testStages, testUser } from '../../test/utils';

afterEach(() => vi.unstubAllGlobals());

const id = testBusiness.id;
const page = businessWebPaths.section(id, 'reports');
const summary: ReportSummary = {
  range: { from: '2026-09-28T00:00:00.000Z', to: '2026-10-28T00:00:00.000Z', days: 30 },
  leads: { current: 12, previous: 9 },
  closeRate: 0.25,
  wonValue: 4500,
  openValue: 9000,
  avgResponseMinutes: 150,
  respondedLeads: 8,
  series: {
    unit: 'day',
    points: [
      { date: '2026-10-26', count: 2 },
      { date: '2026-10-27', count: 0 },
      { date: '2026-10-28', count: 5 },
    ],
  },
  byHour: Array.from({ length: 24 }, (_, h) => (h === 20 ? 5 : h === 9 ? 2 : 0)),
  byStage: testStages.map((s, i) => ({ id: s.id, name: s.name, kind: s.kind, count: i, value: 0 })),
  bySource: [
    { source: 'website_form', count: 7 },
    { source: 'manual', count: 5 },
    { source: 'whatsapp', count: 0 },
  ],
  visits: 120,
  behavior: {
    pageViews: 0,
    topPages: [],
    landing: [],
    devices: { mobile: 0, tablet: 0, desktop: 0 },
    clicks: { phone: 0, whatsapp: 0, email: 0 },
    scroll: { p50: 0, p90: 0 },
    formStarts: 0,
  },
  byAttribution: [
    { source: 'google_ads', name: null, leads: 6, won: 2, lost: 2, wonValue: 3000, visits: 120 },
    { source: 'utm', name: 'newsletter', leads: 2, won: 0, lost: 0, wonValue: 0, visits: 0 },
    { source: 'unknown', name: null, leads: 4, won: 1, lost: 0, wonValue: 1500, visits: 0 },
  ],
  byCampaign: [
    {
      source: 'google_ads',
      name: null,
      campaign: 'summer',
      leads: 6,
      won: 2,
      lost: 2,
      wonValue: 3000,
      visits: 90,
    },
  ],
};

describe('reports page', () => {
  it('shows headline numbers, the chart with a table view, and switches range', async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi({
      [`GET ${apiPaths.auth.me}`]: me(testUser),
      [`GET ${apiPaths.reports.summary(id)}`]: () => json(200, summary),
    });
    renderApp(page);
    expect(await screen.findByText('12')).toBeInTheDocument();
    expect(screen.getByText('+3 לעומת התקופה הקודמת')).toBeInTheDocument();
    expect(screen.getByText('25%')).toBeInTheDocument();
    // F31: the visits tile (the fixture has 120 visits).
    expect(screen.getAllByText('כניסות לאתר').length).toBeGreaterThan(0);
    expect(screen.getAllByText('120').length).toBeGreaterThan(0);
    expect(screen.getByText('2.5 שע׳')).toBeInTheDocument();
    expect(screen.getByRole('listitem', { name: '28.10: 5 פניות' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'הצגה כטבלה' }));
    // The chart's table comes first (the sources tables follow).
    const table = screen.getAllByRole('table')[0]!;
    expect(within(table).getByRole('row', { name: /27\.10 0/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '90 יום' }));
    expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('/reports/summary?days=90'))).toBe(
      true,
    );
  });

  it('shows when inquiries arrive: a column per hour, the peak and the share at night', async () => {
    mockApi({
      [`GET ${apiPaths.auth.me}`]: me(testUser),
      [`GET ${apiPaths.reports.summary(id)}`]: () => json(200, summary),
    });
    renderApp(page);
    expect(await screen.findByRole('list', { name: 'פניות לפי שעה' })).toBeInTheDocument();
    expect(screen.getByRole('listitem', { name: '20:00: 5 פניות' })).toBeInTheDocument();
    expect(screen.getByText('שעת השיא: 20:00 (5 פניות)')).toBeInTheDocument();
    // 5 of 7 came between 18:00 and 09:00 (20:00 yes; 09:00 is working hours)
    expect(screen.getByText('71% מהפניות הגיעו בין 18:00 ל־09:00')).toBeInTheDocument();
  });

  it('shows where customers come from, each row opening those leads (F26)', async () => {
    mockApi({
      [`GET ${apiPaths.auth.me}`]: me(testUser),
      [`GET ${apiPaths.reports.summary(id)}`]: () => json(200, summary),
    });
    renderApp(page);
    const bySource = await screen.findByRole('table', { name: 'לקוחות לפי מקור' });
    const google = within(bySource).getByRole('row', { name: /Google Ads/ });
    expect(
      within(google)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(['Google Ads', '120', '6', '6 מתוך 120 (5%)', '2', shekel.format(3000), '50%']);
    expect(within(bySource).getByText('newsletter')).toBeInTheDocument();
    expect(within(bySource).getByText('לא ידוע')).toBeInTheDocument();
    expect(within(google).getByRole('link')).toHaveAttribute(
      'href',
      `${businessWebPaths.section(id, 'leads')}?view=list&from=google_ads`,
    );
    const campaigns = screen.getByRole('table', { name: 'הקמפיינים המובילים' });
    expect(within(campaigns).getByRole('link')).toHaveAttribute(
      'href',
      `${businessWebPaths.section(id, 'leads')}?view=list&from=google_ads&campaign=summer`,
    );
  });

  it('shows what visitors do on the website (F32)', async () => {
    const withData = {
      ...summary,
      behavior: {
        pageViews: 200,
        topPages: [{ path: '/sale', views: 120 }],
        landing: [{ path: '/sale', visits: 40, leads: 4 }],
        devices: { mobile: 30, tablet: 0, desktop: 10 },
        clicks: { phone: 7, whatsapp: 9, email: 1 },
        scroll: { p50: 100, p90: 50 },
        formStarts: 12,
      },
    };
    mockApi({
      [`GET ${apiPaths.auth.me}`]: me(testUser),
      [`GET ${apiPaths.reports.summary(id)}`]: () => json(200, withData),
    });
    renderApp(page);
    expect(await screen.findByText('מה גולשים עושים באתר')).toBeInTheDocument();
    expect(screen.getByText('גללו עד סוף הדף').nextElementSibling).toHaveTextContent('25%');
    expect(screen.getByText('עד אמצע הדף: 50%')).toBeInTheDocument();
    expect(screen.getByText('4 מתוך 40 (10%)')).toBeInTheDocument();
    expect(screen.getByText('75%', { exact: false })).toBeInTheDocument();
  });

  it('says how to start when no visitor behavior is counted yet (F32)', async () => {
    mockApi({
      [`GET ${apiPaths.auth.me}`]: me(testUser),
      [`GET ${apiPaths.reports.summary(id)}`]: () => json(200, summary),
    });
    renderApp(page);
    expect(await screen.findByText(/עוד אין נתונים/)).toBeInTheDocument();
  });

  it('opens the ads guide: a tab per ad system with the text to paste (F26)', async () => {
    mockApi({
      [`GET ${apiPaths.auth.me}`]: me(testUser),
      [`GET ${apiPaths.reports.summary(id)}`]: () => json(200, summary),
    });
    const { user } = renderApp(page);
    await user.click(await screen.findByRole('button', { name: 'חיבור המודעות שלכם' }));
    const dialog = await screen.findByRole('dialog', { name: 'חיבור המודעות שלכם' });
    expect(within(dialog).getByRole('tab', { name: 'Google Ads' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(
      within(dialog).getByText(
        'utm_source=google&utm_medium=cpc&utm_campaign=summer&utm_term={keyword}',
      ),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('tab', { name: 'פייסבוק ואינסטגרם' }));
    expect(
      within(dialog).getByText(
        'utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.name}}',
      ),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('tab', { name: 'WhatsApp' }));
    expect(within(dialog).getByText(/לא צריך לעשות כלום/)).toBeInTheDocument();
  });

  it('employees see a no-permission state and no nav link', async () => {
    mockApi({
      [`GET ${apiPaths.auth.me}`]: me(testUser),
      [`GET ${apiPaths.businesses.detail(id)}`]: () =>
        json(200, { business: { ...testBusiness, role: 'EMPLOYEE' } }),
      [`GET ${apiPaths.businesses.list}`]: () =>
        json(200, { businesses: [{ ...testBusiness, role: 'EMPLOYEE' }] }),
    });
    renderApp(page);
    expect(await screen.findByText('אין לך הרשאה לצפות בדוחות')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'דוחות' })).not.toBeInTheDocument();
  });
});
