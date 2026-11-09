import { apiPaths, businessWebPaths, type Customer } from '@leadflow/shared';
import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { shekel } from '../leads/api';
import { json, me, mockApi, renderApp, testBusiness, testUser } from '../../test/utils';

afterEach(() => vi.unstubAllGlobals());

const id = testBusiness.id;
const page = businessWebPaths.section(id, 'customers');
const dana: Customer = {
  contactId: '5d000000-0000-4000-8000-000000000001',
  name: 'דנה כהן',
  phone: '+972527654321',
  email: null,
  totalValue: 2500,
  lastPurchaseAt: '2026-11-01T10:00:00.000Z',
  attribution: { source: 'google_ads', seenAt: '2026-10-01T10:00:00.000Z' },
  purchases: [
    {
      leadId: '5c000000-0000-4000-8000-000000000002',
      at: '2026-11-01T10:00:00.000Z',
      value: 1500,
      via: 'quote',
    },
    {
      leadId: '5c000000-0000-4000-8000-000000000001',
      at: '2026-10-01T10:00:00.000Z',
      value: 1000,
      via: 'won',
    },
  ],
};

describe('customers page (D-163)', () => {
  it('lists paying customers with total and source; a row opens their purchases', async () => {
    mockApi({
      [`GET ${apiPaths.auth.me}`]: me(testUser),
      [`GET ${apiPaths.customers.list(id)}`]: () => json(200, { customers: [dana] }),
    });
    const { user } = renderApp(page);
    const row = await screen.findByRole('button', { name: /דנה כהן/ });
    expect(within(row).getByText('Google Ads')).toBeInTheDocument();
    expect(row.textContent).toContain(shekel.format(2500));
    expect(within(row).getByText('2 רכישות')).toBeInTheDocument();
    expect(row).toHaveAttribute('aria-expanded', 'false');

    await user.click(row);
    const purchases = screen.getByRole('list', { name: 'הרכישות של דנה כהן' });
    const links = within(purchases).getAllByRole('link');
    expect(links[0]).toHaveAttribute(
      'href',
      `${businessWebPaths.section(id, 'leads')}/5c000000-0000-4000-8000-000000000002`,
    );
    expect(within(purchases).getByText('הצעת מחיר שאושרה')).toBeInTheDocument();
  });

  it('explains when there are no customers yet', async () => {
    mockApi({
      [`GET ${apiPaths.auth.me}`]: me(testUser),
      [`GET ${apiPaths.customers.list(id)}`]: () => json(200, { customers: [] }),
    });
    renderApp(page);
    expect(await screen.findByText('עוד אין לקוחות')).toBeInTheDocument();
  });
});
