import { apiPaths, businessWebPaths, type ReportSummary } from '@leadflow/shared';
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
  byStage: testStages.map((s, i) => ({ id: s.id, name: s.name, kind: s.kind, count: i, value: 0 })),
  bySource: [
    { source: 'website_form', count: 7 },
    { source: 'manual', count: 5 },
    { source: 'whatsapp', count: 0 },
  ],
  byAttribution: [
    { source: 'google_ads', name: null, leads: 6, won: 2, lost: 2, wonValue: 3000 },
    { source: 'utm', name: 'newsletter', leads: 2, won: 0, lost: 0, wonValue: 0 },
    { source: 'unknown', name: null, leads: 4, won: 1, lost: 0, wonValue: 1500 },
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
    ).toEqual(['Google Ads', '6', '2', shekel.format(3000), '50%']);
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
