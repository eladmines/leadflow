import { apiPaths, businessWebPaths, type Customer } from '@leadflow/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { shekel } from '../leads/api';
import { callsTo, json, me, mockApi, renderApp, testBusiness, testUser } from '../../test/utils';

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
  lastActivityAt: '2026-11-01T10:00:00.000Z',
  bookings: [],
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

  it('shows people who only booked, with their bookings and a cancelled one marked (D-178)', async () => {
    const booker: Customer = {
      contactId: '5d000000-0000-4000-8000-000000000009',
      name: 'נועה לוי',
      phone: '+972521234567',
      email: null,
      totalValue: 0,
      lastPurchaseAt: null,
      lastActivityAt: '2026-11-12T10:00:00.000Z',
      attribution: null,
      purchases: [],
      bookings: [
        {
          appointmentId: '5e000000-0000-4000-8000-000000000001',
          startsAt: '2026-11-12T10:00:00.000Z',
          status: 'CANCELLED',
          serviceName: 'תספורת',
          leadId: null,
        },
        {
          appointmentId: '5e000000-0000-4000-8000-000000000002',
          startsAt: '2026-11-05T10:00:00.000Z',
          status: 'COMPLETED',
          serviceName: null,
          leadId: '5c000000-0000-4000-8000-000000000003',
        },
      ],
    };
    mockApi({
      [`GET ${apiPaths.auth.me}`]: me(testUser),
      [`GET ${apiPaths.customers.list(id)}`]: () => json(200, { customers: [booker] }),
    });
    const { user } = renderApp(page);
    const row = await screen.findByRole('button', { name: /נועה לוי/ });
    expect(within(row).getByText('2 תורים')).toBeInTheDocument();
    // No purchase, so no amount.
    expect(row.textContent).not.toContain(shekel.format(0));

    await user.click(row);
    const bookings = screen.getByRole('list', { name: 'התורים של נועה לוי' });
    expect(within(bookings).getByText('בוטל')).toBeInTheDocument();
    expect(within(bookings).getByText('בוצע')).toBeInTheDocument();
    expect(within(bookings).getByText('תספורת')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'הרכישות של נועה לוי' })).not.toBeInTheDocument();
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

describe('import customers from a spreadsheet (D-179)', () => {
  it('reads a CSV, guesses the columns, sends the rows and reports what happened', async () => {
    const fetchMock = mockApi({
      [`GET ${apiPaths.auth.me}`]: me(testUser),
      [`GET ${apiPaths.customers.list(id)}`]: () => json(200, { customers: [] }),
      [`POST ${apiPaths.customers.import(id)}`]: () =>
        json(200, {
          imported: 2,
          duplicates: 0,
          invalid: [{ row: 3, reason: 'חסר טלפון או אימייל' }],
        }),
    });
    const { user } = renderApp(page);
    await user.click(await screen.findByRole('button', { name: 'ייבוא מ־Excel' }));

    // Hebrew Excel's "CSV" uses semicolons, and a phone typed as a number loses its zero.
    const csv =
      'שם;טלפון;מייל;סכום\nדנה כהן;521234567;dana@example.com;1500\nיוסי לוי;0527654321;;\nרונית;;;\n';
    await user.upload(
      await screen.findByLabelText('בחירת קובץ'),
      new File([csv], 'customers.csv', { type: 'text/csv' }),
    );

    // The columns were matched by their headers; the first rows are previewed.
    expect(await screen.findByText(/3 שורות/)).toBeInTheDocument();
    const preview = screen.getByRole('table', { name: 'תצוגה מקדימה' });
    expect(within(preview).getByText('0521234567')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'ייבוא 3 לקוחות' }));
    await waitFor(() =>
      expect(callsTo(fetchMock, 'POST', apiPaths.customers.import(id))).toEqual([
        {
          rows: [
            { name: 'דנה כהן', phone: '0521234567', email: 'dana@example.com', value: '1500' },
            { name: 'יוסי לוי', phone: '0527654321', email: '', value: '' },
            { name: 'רונית', phone: '', email: '', value: '' },
          ],
        },
      ]),
    );
    expect(await screen.findByText('יובאו 2 לקוחות')).toBeInTheDocument();
    // The failed row is named by its line in the file (header = 1).
    expect(screen.getByText('שורה 4')).toBeInTheDocument();
    expect(screen.getByText('חסר טלפון או אימייל')).toBeInTheDocument();
  });

  it('refuses a file without customers and tells an old .xls to be saved as .xlsx', async () => {
    mockApi({
      [`GET ${apiPaths.auth.me}`]: me(testUser),
      [`GET ${apiPaths.customers.list(id)}`]: () => json(200, { customers: [] }),
    });
    const { user } = renderApp(page);
    await user.click(await screen.findByRole('button', { name: 'ייבוא מ־Excel' }));
    const input = await screen.findByLabelText('בחירת קובץ');

    await user.upload(input, new File(['שם;טלפון\n'], 'empty.csv', { type: 'text/csv' }));
    expect(await screen.findByText(/שורת כותרות ולפחות שורה אחת/)).toBeInTheDocument();

    // (The file picker's accept filter would hide an .xls, but a dropped or renamed file gets here.)
    fireEvent.change(input, {
      target: { files: [new File(['x'], 'old.xls', { type: 'application/vnd.ms-excel' })] },
    });
    expect(await screen.findByText(/קובצי xls ישנים לא נתמכים/)).toBeInTheDocument();
  });

  it('is hidden from employees', async () => {
    mockApi({
      [`GET ${apiPaths.auth.me}`]: me(testUser),
      [`GET ${apiPaths.businesses.detail(id)}`]: () =>
        json(200, { business: { ...testBusiness, role: 'EMPLOYEE' } }),
      [`GET ${apiPaths.businesses.list}`]: () =>
        json(200, { businesses: [{ ...testBusiness, role: 'EMPLOYEE' }] }),
      [`GET ${apiPaths.customers.list(id)}`]: () => json(200, { customers: [] }),
    });
    renderApp(page);
    await screen.findByRole('heading', { name: 'לקוחות' });
    expect(screen.queryByRole('button', { name: 'ייבוא מ־Excel' })).not.toBeInTheDocument();
  });
});
