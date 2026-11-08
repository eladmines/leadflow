import {
  apiPaths,
  businessWebPaths,
  whatsappMessages,
  type Lead,
  type WhatsAppMessage,
  type WhatsAppThreadResponse,
} from '@leadflow/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  apiError,
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
const leadId = '5c000000-0000-4000-8000-000000000009';
const meKey = `GET ${apiPaths.auth.me}`;
const threadPath = apiPaths.whatsapp.thread(id, leadId);
const page = `${businessWebPaths.section(id, 'leads')}/${leadId}`;

const lead: Lead = {
  id: leadId,
  contact: {
    id: '5d000000-0000-4000-8000-000000000009',
    name: 'דנה כהן',
    phone: '+972501112233',
    email: null,
  },
  stage: { id: testStages[0]!.id, name: testStages[0]!.name, kind: 'OPEN' },
  source: 'whatsapp',
  sourceUrl: null,
  message: 'היי, אפשר לקבוע תור?',
  owner: null,
  expectedValue: null,
  nextActionAt: null,
  tags: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const incoming: WhatsAppMessage = {
  id: '8a000000-0000-4000-8000-000000000001',
  direction: 'IN',
  body: 'היי, אפשר לקבוע תור?',
  status: 'received',
  sender: null,
  createdAt: new Date().toISOString(),
};
const reply: WhatsAppMessage = {
  id: '8a000000-0000-4000-8000-000000000002',
  direction: 'OUT',
  body: 'בטח! מתי נוח לך?',
  status: 'read',
  sender: { id: testUser.id, name: 'סיגלית' },
  createdAt: new Date().toISOString(),
};

function routes(thread: WhatsAppThreadResponse, extra = {}) {
  return {
    [meKey]: me(testUser),
    [`GET ${apiPaths.businesses.members(id)}`]: () => json(200, { members: [] }),
    [`GET ${apiPaths.leads.detail(id, leadId)}`]: () =>
      json(200, {
        lead,
        activities: [
          {
            id: '7a000000-0000-4000-8000-000000000009',
            type: 'lead.created',
            data: { source: 'whatsapp' },
            actor: null,
            createdAt: lead.createdAt,
          },
        ],
      }),
    [`GET ${threadPath}`]: () => json(200, thread),
    ...extra,
  };
}

const open = () => new Date(Date.now() + 20 * 3600_000).toISOString();

describe('WhatsApp on the lead page', () => {
  it('shows the conversation with who wrote what and the delivery status', async () => {
    mockApi(
      routes({
        connected: true,
        messages: [incoming, reply],
        replyUntil: open(),
        botPaused: false,
      }),
    );
    const { user } = renderApp(page);
    const list = await screen.findByRole('list', { name: 'שיחת וואטסאפ' });
    const items = within(list).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('הלקוח כתב:');
    expect(items[0]).toHaveTextContent('היי, אפשר לקבוע תור?');
    expect(items[1]).toHaveTextContent('נשלחה על ידי סיגלית:');
    expect(items[1]).toHaveTextContent('נקראה');
    // History is in its own tab (D-140).
    await user.click(screen.getByRole('tab', { name: 'הערות והיסטוריה' }));
    expect(await screen.findByText('הליד נוצר מהודעת וואטסאפ')).toBeInTheDocument();
  });

  it('a Facebook lead: its tab, the conversation and the reply say Facebook (F23)', async () => {
    const fbLead = {
      ...lead,
      source: 'facebook' as const,
      contact: { ...lead.contact, phone: null },
    };
    mockApi({
      ...routes({
        connected: true,
        messages: [{ ...incoming, channel: 'messenger' }],
        replyUntil: open(),
        botPaused: false,
        channel: 'messenger',
      }),
      [`GET ${apiPaths.leads.detail(id, leadId)}`]: () =>
        json(200, { lead: fbLead, activities: [] }),
    });
    renderApp(page);
    expect(await screen.findByRole('tab', { name: 'פייסבוק' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(await screen.findByRole('heading', { name: 'Facebook Messenger' })).toBeInTheDocument();
    expect(screen.getByLabelText('תשובה בפייסבוק')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'שליחה בפייסבוק' })).toBeInTheDocument();
    // No booking bot on Facebook.
    expect(screen.queryByRole('button', { name: 'השהיית הבוט' })).not.toBeInTheDocument();
  });

  it('sends a reply while the window is open', async () => {
    const fetchMock = mockApi(
      routes(
        { connected: true, messages: [incoming], replyUntil: open(), botPaused: false },
        { [`POST ${threadPath}`]: () => json(201, { message: reply }) },
      ),
    );
    const { user } = renderApp(page);
    const box = await screen.findByLabelText('תשובה בוואטסאפ');
    expect(screen.getByText(/אפשר לענות עד/)).toBeInTheDocument();
    await user.type(box, 'בטח! מתי נוח לך?');
    await user.click(screen.getByRole('button', { name: 'שליחה בוואטסאפ' }));
    await waitFor(() =>
      expect(callsTo(fetchMock, 'POST', threadPath)).toEqual([{ text: 'בטח! מתי נוח לך?' }]),
    );
    await waitFor(() => expect(box).toHaveValue(''));
  });

  it('validates an empty reply and shows a server error', async () => {
    const fetchMock = mockApi(
      routes(
        { connected: true, messages: [incoming], replyUntil: open(), botPaused: false },
        {
          [`POST ${threadPath}`]: () =>
            apiError(500, 'INTERNAL_ERROR', whatsappMessages.sendFailed),
        },
      ),
    );
    const { user } = renderApp(page);
    await screen.findByLabelText('תשובה בוואטסאפ');
    await user.click(screen.getByRole('button', { name: 'שליחה בוואטסאפ' }));
    expect(await screen.findByText(whatsappMessages.textRequired)).toBeInTheDocument();
    expect(callsTo(fetchMock, 'POST', threadPath)).toHaveLength(0);

    await user.type(screen.getByLabelText('תשובה בוואטסאפ'), 'היי');
    await user.click(screen.getByRole('button', { name: 'שליחה בוואטסאפ' }));
    expect(await screen.findByText(whatsappMessages.sendFailed)).toBeInTheDocument();
  });

  it('explains when the 24-hour window has closed', async () => {
    mockApi(routes({ connected: true, messages: [incoming], replyUntil: null, botPaused: false }));
    renderApp(page);
    expect(await screen.findByText(whatsappMessages.windowClosed)).toBeInTheDocument();
    expect(screen.queryByLabelText('תשובה בוואטסאפ')).not.toBeInTheDocument();
  });

  it('pauses the booking bot for this customer, and resumes it (D-108)', async () => {
    let paused = false;
    const fetchMock = mockApi(
      routes(
        { connected: true, messages: [incoming], replyUntil: open(), botPaused: false },
        {
          [`GET ${threadPath}`]: () =>
            json(200, {
              connected: true,
              messages: [incoming],
              replyUntil: open(),
              botPaused: paused,
            }),
          [`PUT ${apiPaths.whatsapp.botPause(testBusiness.id, leadId)}`]: (body: unknown) => {
            paused = (body as { paused: boolean }).paused;
            return new Response(null, { status: 204 });
          },
        },
      ),
    );
    const { user } = renderApp(page);
    expect(await screen.findByText('הבוט יכול לענות בשיחה הזו')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'השהיית הבוט' }));
    expect(await screen.findByText('הבוט מושהה בשיחה הזו')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'הפעלת הבוט' }));
    expect(await screen.findByText('הבוט יכול לענות בשיחה הזו')).toBeInTheDocument();
    expect(callsTo(fetchMock, 'PUT', apiPaths.whatsapp.botPause(testBusiness.id, leadId))).toEqual([
      { paused: true },
      { paused: false },
    ]);
  });

  it('says there is no conversation when WhatsApp is not connected and there is no history', async () => {
    mockApi(routes({ connected: false, messages: [], replyUntil: null, botPaused: false }));
    renderApp(`${page}?tab=whatsapp`);
    expect(await screen.findByText(/אין שיחת וואטסאפ עם הליד/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'שליחה בוואטסאפ' })).not.toBeInTheDocument();
  });
});
