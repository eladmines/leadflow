import {
  apiPaths,
  businessWebPaths,
  type Business,
  type InboxNumber,
  type WhatsAppInboxResponse,
} from '@leadflow/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { callsTo, json, me, mockApi, renderApp, testBusiness, testUser } from '../../test/utils';

afterEach(() => vi.unstubAllGlobals());

const id = testBusiness.id;
const wp = apiPaths.whatsapp;
const meKey = `GET ${apiPaths.auth.me}`;
const page = businessWebPaths.section(id, 'conversations');

const number: InboxNumber = {
  id: '9a000000-0000-4000-8000-000000000001',
  phone: '+972541234567',
  profileName: 'נועה',
  messages: [
    {
      id: '8b000000-0000-4000-8000-000000000001',
      direction: 'IN',
      body: 'היי, יש תור מחר?',
      status: 'received',
      sender: null,
      createdAt: new Date().toISOString(),
    },
  ],
  lastMessageAt: new Date().toISOString(),
};
const leadId = '5c000000-0000-4000-8000-0000000000aa';

function routes(inbox: WhatsAppInboxResponse, extra = {}) {
  return {
    [meKey]: me(testUser),
    [`GET ${wp.inbox(id)}`]: () => json(200, inbox),
    [`GET ${wp.personal(id)}`]: () => json(200, { numbers: [] }),
    [`GET ${wp.bot(id)}`]: () =>
      json(200, { connected: true, settings: { enabled: false, autoConfirm: true } }),
    ...extra,
  };
}

describe('WhatsApp conversations inbox', () => {
  it('switches the booking bot on and chooses how its bookings are approved (D-102)', async () => {
    const fetchMock = mockApi(
      routes(
        { connected: true, numbers: [] },
        {
          [`PUT ${wp.bot(id)}`]: (body: unknown) => json(200, { connected: true, settings: body }),
        },
      ),
    );
    const { user } = renderApp(page);
    const on = await screen.findByRole('checkbox', { name: 'הבוט פעיל' });
    const pending = screen.getByRole('radio', { name: /ממתינים לאישור שלכם/ });
    expect(pending).toBeDisabled();
    await user.click(on);
    await waitFor(() => expect(on).toBeChecked());
    await user.click(pending);
    await waitFor(() =>
      expect(callsTo(fetchMock, 'PUT', wp.bot(id))).toEqual([
        { enabled: true, autoConfirm: true },
        { enabled: true, autoConfirm: false },
      ]),
    );
  });

  it("shows the bot's replies as automatic", async () => {
    const bot = {
      ...number.messages[0]!,
      id: '8b000000-0000-4000-8000-000000000002',
      direction: 'OUT' as const,
      body: 'באיזה יום נוח לכם?',
      status: 'sent' as const,
    };
    mockApi(
      routes({ connected: true, numbers: [{ ...number, messages: [...number.messages, bot] }] }),
    );
    renderApp(page);
    expect(await screen.findByText('באיזה יום נוח לכם?')).toBeInTheDocument();
    expect(screen.getByText('תשובה אוטומטית')).toBeInTheDocument();
  });

  it('lists unclassified numbers with their messages', async () => {
    mockApi(routes({ connected: true, numbers: [number] }));
    renderApp(page);
    const list = await screen.findByRole('list', { name: 'מספרים שמחכים לסיווג' });
    const [card] = within(list).getAllByRole('listitem') as [HTMLElement];
    expect(within(card).getByRole('heading', { name: 'נועה' })).toBeInTheDocument();
    expect(within(card).getByText('054-1234567')).toBeInTheDocument();
    expect(within(card).getByText('היי, יש תור מחר?')).toBeInTheDocument();
    expect(within(card).getByText('לא מסווג')).toBeInTheDocument();
  });

  it('marks a number business and links to the new lead', async () => {
    const fetchMock = mockApi(
      routes(
        { connected: true, numbers: [number] },
        {
          [`POST ${wp.classify(id, number.id)}`]: () => json(200, { status: 'BUSINESS', leadId }),
        },
      ),
    );
    const { user } = renderApp(page);
    await user.click(await screen.findByRole('button', { name: /עסקי: יצירת ליד/ }));
    await waitFor(() =>
      expect(callsTo(fetchMock, 'POST', wp.classify(id, number.id))).toEqual([{ as: 'BUSINESS' }]),
    );
    expect(await screen.findByRole('link', { name: 'פתיחת הליד' })).toHaveAttribute(
      'href',
      `${businessWebPaths.section(id, 'leads')}/${leadId}`,
    );
  });

  it('marks a number personal and explains what happens', async () => {
    const fetchMock = mockApi(
      routes(
        { connected: true, numbers: [number] },
        {
          [`POST ${wp.classify(id, number.id)}`]: () =>
            json(200, { status: 'PERSONAL', leadId: null }),
        },
      ),
    );
    const { user } = renderApp(page);
    await user.click(await screen.findByRole('button', { name: /^פרטי$/ }));
    await waitFor(() =>
      expect(callsTo(fetchMock, 'POST', wp.classify(id, number.id))).toEqual([{ as: 'PERSONAL' }]),
    );
    expect(await screen.findByText(/נועה סומן\/ה כפרטי/)).toBeInTheDocument();
  });

  it('lists personal numbers and undoes a marking', async () => {
    const personalId = '9a000000-0000-4000-8000-000000000002';
    const fetchMock = mockApi(
      routes(
        { connected: true, numbers: [] },
        {
          [`GET ${wp.personal(id)}`]: () =>
            json(200, {
              numbers: [{ id: personalId, phone: '+972521112233', classifiedAt: null }],
            }),
          [`DELETE ${wp.number(id, personalId)}`]: () => new Response(null, { status: 204 }),
        },
      ),
    );
    const { user } = renderApp(page);
    expect(await screen.findByText('אין הודעות שמחכות לסיווג')).toBeInTheDocument();
    await user.click(await screen.findByText('מספרים פרטיים (1)'));
    await user.click(screen.getByRole('button', { name: 'ביטול סימון פרטי ל-052-1112233' }));
    await waitFor(() =>
      expect(callsTo(fetchMock, 'DELETE', wp.number(id, personalId))).toHaveLength(1),
    );
  });

  it('"רענון" loads numbers that wrote since the page opened', async () => {
    let calls = 0;
    mockApi({
      ...routes({ connected: true, numbers: [] }),
      [`GET ${wp.inbox(id)}`]: () => {
        calls += 1;
        return json(200, { connected: true, numbers: calls > 1 ? [number] : [] });
      },
    });
    const { user } = renderApp(page);
    await screen.findByText('אין הודעות שמחכות לסיווג');
    await user.click(screen.getByRole('button', { name: 'רענון' }));
    expect(await screen.findByRole('heading', { name: 'נועה' })).toBeInTheDocument();
  });

  it('explains when WhatsApp is not connected', async () => {
    mockApi(routes({ connected: false, numbers: [] }));
    renderApp(page);
    expect(await screen.findByText('WhatsApp עדיין לא מחובר')).toBeInTheDocument();
  });

  it('employees get a no-permission state and no menu link', async () => {
    mockApi({
      ...routes({ connected: true, numbers: [number] }),
      [`GET ${apiPaths.businesses.detail(id)}`]: () =>
        json(200, { business: { ...testBusiness, role: 'EMPLOYEE' as Business['role'] } }),
      [`GET ${apiPaths.businesses.list}`]: () =>
        json(200, { businesses: [{ ...testBusiness, role: 'EMPLOYEE' }] }),
    });
    renderApp(page);
    expect(
      await screen.findByRole('heading', { name: 'אין לך הרשאה לצפות בשיחות WhatsApp' }),
    ).toBeInTheDocument();
    const nav = screen.getAllByRole('navigation', { name: 'ניווט ראשי' })[0]!;
    expect(within(nav).queryByRole('link', { name: /שיחות/ })).not.toBeInTheDocument();
  });

  it('the leads page points to waiting numbers', async () => {
    mockApi(routes({ connected: true, numbers: [number, { ...number, id: crypto.randomUUID() }] }));
    renderApp(businessWebPaths.section(id, 'leads'));
    expect(await screen.findByText(/2 מספרים חדשים כתבו בוואטסאפ/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'לשיחות' })).toHaveAttribute('href', page);
  });
});
