import { apiPaths, businessWebPaths, type PublicQuote, type Quote } from '@leadflow/shared';
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

const id = testBusiness.id;
const qp = apiPaths.quotes;
const meKey = `GET ${apiPaths.auth.me}`;
const leadId = '5c000000-0000-4000-8000-000000000001';
const lead = {
  id: leadId,
  contact: {
    id: '5d000000-0000-4000-8000-000000000001',
    name: 'רון לוי',
    phone: '+972521112233',
    email: 'ron@example.com',
  },
  stage: { id: testStages[0]!.id, name: testStages[0]!.name, kind: 'OPEN' as const },
  source: 'manual' as const,
  sourceUrl: null,
  message: null,
  owner: null,
  expectedValue: null,
  nextActionAt: null,
  tags: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};
const quote = (over: Partial<Quote> = {}): Quote => ({
  id: '7d000000-0000-4000-8000-000000000001',
  number: 1001,
  title: 'שיפוץ',
  items: [{ description: 'עבודה', quantity: 2, unitPrice: 50000 }],
  discount: 0,
  vatRate: 18,
  notes: '',
  validUntil: null,
  status: 'DRAFT',
  expired: false,
  totals: { subtotal: 100000, discount: 0, vat: 18000, total: 118000 },
  lead: { id: leadId },
  customer: { name: 'רון לוי', phone: '+972521112233', email: 'ron@example.com' },
  publicUrl: null,
  sentAt: null,
  decidedAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...over,
});

describe('quote editor', () => {
  it('computes totals live and creates the draft from a lead', async () => {
    const fetchMock = mockApi({
      [meKey]: me(testUser),
      [`GET ${apiPaths.leads.detail(id, leadId)}`]: () => json(200, { lead, activities: [] }),
      [`POST ${qp.list(id)}`]: () => json(201, { quote: quote() }),
      [`GET ${qp.quote(id, quote().id)}`]: () => json(200, { quote: quote() }),
    });
    const { user, location } = renderApp(
      `${businessWebPaths.section(id, 'quotes')}/new?leadId=${leadId}`,
    );
    expect(await screen.findByRole('heading', { name: 'הצעת מחיר חדשה' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('תיאור שורה 1'), 'עבודה');
    await user.clear(screen.getByLabelText('כמות שורה 1'));
    await user.type(screen.getByLabelText('כמות שורה 1'), '2');
    await user.type(screen.getByLabelText('מחיר יחידה שורה 1'), '500');
    const summary = screen.getByLabelText('סיכום');
    // 1000 + 18% VAT; without VAT the total equals the subtotal.
    expect(summary).toHaveTextContent(/סה״כ לתשלום.*1,180/);
    await user.click(screen.getByRole('checkbox', { name: /מע״מ/ }));
    expect(summary).toHaveTextContent(/סה״כ לתשלום.*1,000/);
    expect(summary).not.toHaveTextContent('מע״מ');
    await user.click(screen.getByRole('checkbox', { name: /מע״מ/ }));

    await user.click(screen.getByRole('button', { name: 'שמירה כטיוטה' }));
    await waitFor(() => expect(callsTo(fetchMock, 'POST', qp.list(id))).toHaveLength(1));
    expect(callsTo(fetchMock, 'POST', qp.list(id))[0]).toMatchObject({
      leadId,
      items: [{ description: 'עבודה', quantity: 2, unitPrice: 50000 }],
      vatRate: 18,
    });
    await waitFor(() =>
      expect(location()).toBe(`${businessWebPaths.section(id, 'quotes')}/${quote().id}`),
    );
  });

  it('sends a draft and offers WhatsApp and copy-link', async () => {
    const sent = quote({
      status: 'SENT',
      publicUrl: 'http://localhost:5173/q/abc',
      sentAt: new Date().toISOString(),
    });
    const fetchMock = mockApi({
      [meKey]: me(testUser),
      [`GET ${apiPaths.leads.detail(id, leadId)}`]: () => json(200, { lead, activities: [] }),
      [`GET ${qp.quote(id, quote().id)}`]: () => json(200, { quote: quote() }),
      [`PUT ${qp.quote(id, quote().id)}`]: () => json(200, { quote: quote() }),
      [`POST ${qp.send(id, quote().id)}`]: () => json(200, { quote: sent }),
    });
    const { user } = renderApp(`${businessWebPaths.section(id, 'quotes')}/${quote().id}`);
    await user.click(await screen.findByRole('button', { name: 'שליחה ללקוח' }));
    const dialog = await screen.findByRole('dialog', { name: 'שליחת ההצעה ללקוח' });
    expect(within(dialog).getByRole('checkbox')).toBeChecked();
    await user.click(within(dialog).getByRole('button', { name: 'שליחה' }));
    expect(await within(dialog).findByRole('link', { name: /WhatsApp/ })).toHaveAttribute(
      'href',
      expect.stringContaining('https://wa.me/972521112233?text='),
    );
    expect(callsTo(fetchMock, 'POST', qp.send(id, quote().id))).toEqual([{ email: true }]);
  });

  it('a sent quote is read-only and can be duplicated', async () => {
    const sent = quote({ status: 'SENT', publicUrl: 'http://localhost:5173/q/abc' });
    mockApi({
      [meKey]: me(testUser),
      [`GET ${apiPaths.leads.detail(id, leadId)}`]: () => json(200, { lead, activities: [] }),
      [`GET ${qp.quote(id, sent.id)}`]: () => json(200, { quote: sent }),
    });
    renderApp(`${businessWebPaths.section(id, 'quotes')}/${sent.id}`);
    expect(await screen.findByRole('button', { name: /שכפול לעריכה/ })).toBeInTheDocument();
    expect(screen.getByLabelText('תיאור שורה 1')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'שמירה' })).not.toBeInTheDocument();
  });
});

describe('customer quote page', () => {
  const pq: PublicQuote = {
    number: 1001,
    title: 'שיפוץ',
    items: [{ description: 'עבודה', quantity: 2, unitPrice: 50000 }],
    vatRate: 18,
    notes: 'כולל פינוי',
    validUntil: '2030-01-31',
    status: 'SENT',
    expired: false,
    totals: { subtotal: 100000, discount: 0, vat: 18000, total: 118000 },
    sentAt: new Date().toISOString(),
    customerName: 'רון לוי',
    business: { name: 'שיפוצי הצפון', phone: '+97248123456', address: 'חיפה' },
  };
  const token = 'A'.repeat(43);

  it('shows the quote and accepts after confirmation', async () => {
    const fetchMock = mockApi({
      [`GET ${qp.publicQuote(token)}`]: () => json(200, { quote: pq }),
      [`POST ${qp.publicDecision(token)}`]: () =>
        json(200, { quote: { ...pq, status: 'ACCEPTED' } }),
    });
    const { user } = renderApp(`/q/${token}`);
    expect(await screen.findByRole('heading', { name: 'הצעת מחיר מס׳ 1001' })).toBeInTheDocument();
    expect(screen.getByText('בתוקף עד 31/01/2030')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'אישור ההצעה' }));
    await user.click(screen.getByRole('button', { name: 'כן, מאשר/ת' }));
    expect(await screen.findByText(/ההצעה אושרה/)).toBeInTheDocument();
    expect(callsTo(fetchMock, 'POST', qp.publicDecision(token))).toEqual([{ decision: 'accept' }]);
    expect(screen.queryByRole('button', { name: 'אישור ההצעה' })).not.toBeInTheDocument();
  });
});
