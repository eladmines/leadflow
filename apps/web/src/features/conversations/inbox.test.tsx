import {
  apiPaths,
  businessWebPaths,
  type ConversationListResponse,
  type ConversationResponse,
  type ConversationSummary,
} from '@leadflow/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { callsTo, json, me, mockApi, renderApp, testBusiness, testUser } from '../../test/utils';

afterEach(() => vi.unstubAllGlobals());

const id = testBusiness.id;
const cp = apiPaths.conversations;
const page = businessWebPaths.section(id, 'conversations');
const leadId = '5c000000-0000-4000-8000-0000000000aa';
const now = new Date().toISOString();

const noa: ConversationSummary = {
  id: '9a000000-0000-4000-8000-000000000001',
  channel: 'whatsapp',
  status: 'BUSINESS',
  name: 'נועה',
  phone: '+972541234567',
  leadId,
  lastMessage: { body: 'היי, יש תור מחר?', direction: 'IN', at: now },
  lastMessageAt: now,
  unread: true,
};
const yossi: ConversationSummary = {
  id: '9a000000-0000-4000-8000-000000000002',
  channel: 'messenger',
  status: 'UNCLASSIFIED',
  name: null,
  phone: null,
  leadId: null,
  lastMessage: { body: 'כמה עולה צבע?', direction: 'IN', at: now },
  lastMessageAt: now,
  unread: false,
};
const listOf = (conversations: ConversationSummary[]): ConversationListResponse => ({
  connected: true,
  conversations,
  nextCursor: null,
  unreadCount: conversations.filter((c) => c.unread).length,
});
const detailOf = (c: ConversationSummary, extra: Partial<ConversationResponse> = {}) =>
  ({
    conversation: c,
    messages: [
      {
        id: '8a000000-0000-4000-8000-000000000001',
        direction: 'IN',
        body: c.lastMessage!.body,
        status: 'received',
        sender: null,
        createdAt: now,
        ...(c.channel === 'messenger' ? { channel: 'messenger' } : {}),
      },
      {
        id: '8a000000-0000-4000-8000-000000000002',
        direction: 'OUT',
        body: 'באיזה יום נוח לכם?',
        status: 'sent',
        sender: null,
        createdAt: now,
      },
    ],
    replyUntil: new Date(Date.now() + 20 * 3600_000).toISOString(),
    ...extra,
  }) satisfies ConversationResponse;

function routes(extra = {}) {
  return {
    [`GET ${apiPaths.auth.me}`]: me(testUser),
    [`GET ${cp.list(id)}`]: () => json(200, listOf([noa, yossi])),
    [`GET ${cp.unread(id)}`]: () => json(200, { unreadCount: 1 }),
    [`GET ${cp.detail(id, noa.id)}`]: () => json(200, detailOf(noa)),
    [`GET ${cp.detail(id, yossi.id)}`]: () => json(200, detailOf(yossi)),
    [`POST ${cp.read(id, noa.id)}`]: () => new Response(null, { status: 204 }),
    ...extra,
  };
}

describe('unified inbox (F24)', () => {
  it('lists WhatsApp and Facebook conversations together, with the unread count', async () => {
    mockApi(routes());
    renderApp(page);
    const list = await screen.findByRole('list', { name: 'שיחות' });
    const [first, second] = within(list).getAllByRole('listitem') as [HTMLElement, HTMLElement];
    expect(first).toHaveTextContent('נועה');
    expect(first).toHaveTextContent('WhatsApp');
    expect(first).toHaveTextContent('לא נקראה');
    expect(second).toHaveTextContent('משתמש/ת פייסבוק');
    expect(second).toHaveTextContent('פייסבוק');
    expect(screen.getByRole('button', { name: 'לא נקראו (1)' })).toBeInTheDocument();
  });

  it('opens a conversation, marks it read, links to the lead and replies on its channel', async () => {
    const fetchMock = mockApi(
      routes({
        [`POST ${cp.messages(id, noa.id)}`]: () =>
          json(201, {
            message: {
              id: '8a000000-0000-4000-8000-000000000003',
              direction: 'OUT',
              body: 'מחר ב-10:00 פנוי',
              status: 'sent',
              sender: { id: testUser.id, name: 'סיגלית' },
              createdAt: now,
            },
          }),
      }),
    );
    const { user } = renderApp(page);
    await user.click(await screen.findByRole('button', { name: /נועה/ }));
    const pane = await screen.findByRole('region', { name: 'נועה' });
    expect(within(pane).getByText('תשובה אוטומטית', { exact: false })).toBeInTheDocument();
    await waitFor(() => expect(callsTo(fetchMock, 'POST', cp.read(id, noa.id))).toHaveLength(1));
    expect(within(pane).getByRole('link', { name: /פתיחת הליד/ })).toHaveAttribute(
      'href',
      `${businessWebPaths.section(id, 'leads')}/${leadId}`,
    );
    await user.type(within(pane).getByLabelText('תשובה בוואטסאפ'), 'מחר ב-10:00 פנוי');
    await user.click(within(pane).getByRole('button', { name: 'שליחה בוואטסאפ' }));
    await waitFor(() =>
      expect(callsTo(fetchMock, 'POST', cp.messages(id, noa.id))).toEqual([
        { text: 'מחר ב-10:00 פנוי' },
      ]),
    );
  });

  it('a new Facebook sender needs no classifying: just the chat to answer in', async () => {
    mockApi(routes());
    const { user } = renderApp(`${page}?c=${yossi.id}`);
    const pane = await screen.findByRole('region', { name: 'משתמש/ת פייסבוק' });
    expect(within(pane).getByLabelText('תשובה בפייסבוק')).toBeInTheDocument();
    expect(within(pane).queryByRole('button', { name: /עסקי: יצירת ליד|פרטי/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /חדשים/ })).toBeNull();
    expect(user).toBeTruthy();
  });

  it('an email conversation shows its address and subject, and replies need no 24-hour window (F27)', async () => {
    const dana: ConversationSummary = {
      id: '9a000000-0000-4000-8000-000000000003',
      channel: 'email',
      status: 'BUSINESS',
      name: 'דנה כהן',
      phone: null,
      email: 'dana@example.com',
      leadId,
      lastMessage: { body: 'אפשר תור ליום חמישי?', direction: 'IN', at: now },
      lastMessageAt: now,
      unread: false,
    };
    const fetchMock = mockApi(
      routes({
        [`GET ${cp.list(id)}`]: () => json(200, listOf([dana])),
        [`GET ${cp.detail(id, dana.id)}`]: () =>
          json(
            200,
            detailOf(dana, {
              replyUntil: null,
              messages: [
                {
                  id: '8a000000-0000-4000-8000-000000000003',
                  direction: 'IN',
                  body: 'אפשר תור ליום חמישי?',
                  subject: 'תור ליום חמישי',
                  channel: 'email',
                  status: 'received',
                  sender: null,
                  createdAt: now,
                },
              ],
            }),
          ),
        [`POST ${cp.messages(id, dana.id)}`]: () =>
          json(201, {
            message: {
              id: '8a000000-0000-4000-8000-000000000004',
              direction: 'OUT',
              body: 'בטח!',
              status: 'sent',
              sender: null,
              createdAt: now,
            },
            leadId,
          }),
      }),
    );
    const { user } = renderApp(`${page}?c=${dana.id}`);
    const pane = await screen.findByRole('region', { name: 'דנה כהן' });
    expect(within(pane).getByText('dana@example.com')).toBeInTheDocument();
    expect(within(pane).getByText('תור ליום חמישי')).toBeInTheDocument();
    // No window notice: the reply box is there even though no window is open.
    await user.type(within(pane).getByLabelText('תשובה במייל'), 'בטח!');
    await user.click(within(pane).getByRole('button', { name: 'שליחה במייל' }));
    await waitFor(() =>
      expect(callsTo(fetchMock, 'POST', cp.messages(id, dana.id))).toEqual([{ text: 'בטח!' }]),
    );
  });

  it('after 24 hours explains why it can’t reply; empty and not-connected states', async () => {
    mockApi(
      routes({
        [`GET ${cp.detail(id, noa.id)}`]: () =>
          json(200, detailOf({ ...noa, unread: false }, { replyUntil: null })),
      }),
    );
    renderApp(`${page}?c=${noa.id}`);
    expect(await screen.findByText(/אפשר לענות בוואטסאפ רק עד 24 שעות/)).toBeInTheDocument();
  });

  it('shows an empty inbox, and filters by unread', async () => {
    const fetchMock = mockApi(
      routes({
        [`GET ${cp.list(id)}`]: () => json(200, { ...listOf([]), connected: false }),
      }),
    );
    const { user } = renderApp(page);
    expect(await screen.findByText('עדיין אין שיחות')).toBeInTheDocument();
    expect(screen.getByText(/אחרי חיבור WhatsApp או פייסבוק/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'לא נקראו' }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes('filter=unread'))).toBe(
        true,
      ),
    );
  });
});
