import { apiPaths, businessWebPaths, type ReportSummary } from '@leadflow/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
    const table = screen.getByRole('table');
    expect(within(table).getByRole('row', { name: /27\.10 0/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '90 יום' }));
    expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('/reports/summary?days=90'))).toBe(
      true,
    );
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
