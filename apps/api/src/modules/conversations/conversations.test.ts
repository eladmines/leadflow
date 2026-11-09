import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { apiPaths, CONVERSATIONS_PAGE } from '@leadflow/shared';
import { createTestApp, resetDb, testConfig } from '../../../test/helpers';
import { addMember, newUser, req } from '../../../test/business-helpers';
import { MemoryMessengerSender } from '../../integrations/messenger';
import { MemoryWhatsAppSender, signWebhookBody } from '../../integrations/whatsapp';
import { MemoryEmailSender } from '../../integrations/email';
import { buildApp } from '../../app';

const BUSINESS_ID = '33333333-4444-4555-8666-777777777777';
const SECRET = 'test-app-secret-0123456789';
const PHONE_ID = '1234567890';
const PAGE_ID = '1122334455';
const cp = apiPaths.conversations;

let seq = 0;
const whatsappText = (body: string, from = '972501112233', name = 'נועה', later = 0) => {
  seq += 1;
  return {
    url: apiPaths.whatsapp.webhook,
    payload: {
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: PHONE_ID },
                contacts: [{ wa_id: from, profile: { name } }],
                messages: [
                  {
                    from,
                    id: `wamid.inbox-${seq}-${Date.now()}`,
                    timestamp: String(Math.floor(Date.now() / 1000) + later),
                    type: 'text',
                    text: { body },
                  },
                ],
              },
            },
          ],
        },
      ],
    },
  };
};
const facebookText = (text: string, psid = '7766554433') => {
  seq += 1;
  return {
    url: apiPaths.whatsapp.messengerWebhook,
    payload: {
      object: 'page',
      entry: [
        {
          id: PAGE_ID,
          messaging: [
            {
              sender: { id: psid },
              recipient: { id: PAGE_ID },
              timestamp: Date.now(),
              message: { mid: `m_inbox-${seq}-${Date.now()}`, text },
            },
          ],
        },
      ],
    },
  };
};

describe('unified inbox (F24)', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  const whatsapp = new MemoryWhatsAppSender();
  const messenger = new MemoryMessengerSender();

  beforeAll(async () => {
    const config = testConfig({
      WHATSAPP_BUSINESS_ID: BUSINESS_ID,
      WHATSAPP_PHONE_NUMBER_ID: PHONE_ID,
      MESSENGER_BUSINESS_ID: BUSINESS_ID,
      MESSENGER_PAGE_ID: PAGE_ID,
      WHATSAPP_APP_SECRET: SECRET,
      WHATSAPP_VERIFY_TOKEN: 'verify-me-please',
    });
    const base = await createTestApp({ config });
    await base.app.close();
    const app = await buildApp({
      config,
      prisma: base.prisma,
      emailSender: new MemoryEmailSender(),
      whatsappSender: whatsapp,
      messengerSender: messenger,
    });
    await app.ready();
    ctx = {
      ...base,
      app,
      close: async () => {
        await app.close();
        await base.prisma.$disconnect();
      },
    };
  });
  afterAll(() => ctx.close());
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    whatsapp.clear();
    messenger.clear();
  });

  async function setup() {
    const owner = await newUser(ctx.app, 'inbox-owner');
    await ctx.prisma.business.create({
      data: {
        id: BUSINESS_ID,
        name: 'מספרת שירן',
        industry: 'beauty',
        status: 'ACTIVE',
        // Nothing answers automatically in these tests.
        whatsappReplyMode: 'off',
      },
    });
    await addMember(ctx.prisma, BUSINESS_ID, owner.userId, 'OWNER');
    return owner;
  }
  const post = async (event: { url: string; payload: object }) => {
    const raw = JSON.stringify(event.payload);
    const res = await ctx.app.inject({
      method: 'POST',
      url: event.url,
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': signWebhookBody(raw, SECRET),
      },
      payload: raw,
    });
    expect(res.statusCode).toBe(200);
  };
  const list = async (token: string, query = '') =>
    (await req(ctx.app, 'GET', `${cp.list(BUSINESS_ID)}${query}`, token)).json();

  it('lists WhatsApp and Facebook conversations together, newest first, with filters', async () => {
    const owner = await setup();
    messenger.names.set('7766554433', 'יוסי לוי');
    await post(whatsappText('היי, יש תור?'));
    await post(facebookText('כמה עולה צבע?'));
    // A personal number never shows.
    await post(whatsappText('מה נשמע', '972509998877', 'אמא'));
    const mom = await ctx.prisma.whatsAppNumber.findFirstOrThrow({
      where: { phone: '+972509998877' },
    });
    await req(ctx.app, 'POST', apiPaths.whatsapp.classify(BUSINESS_ID, mom.id), owner.token, {
      as: 'PERSONAL',
    });

    const all = await list(owner.token);
    expect(all.connected).toBe(true);
    expect(all.unreadCount).toBe(2);
    expect(
      all.conversations.map((c: { name: string; channel: string }) => [c.name, c.channel]),
    ).toEqual([
      ['יוסי לוי', 'messenger'],
      ['נועה', 'whatsapp'],
    ]);
    expect(all.conversations[0]).toMatchObject({
      status: 'UNCLASSIFIED',
      phone: null,
      unread: true,
      leadId: null,
      lastMessage: { body: 'כמה עולה צבע?', direction: 'IN' },
    });
    expect(all.conversations[1].phone).toBe('+972501112233');

    expect((await list(owner.token, '?channel=whatsapp')).conversations).toHaveLength(1);
    expect((await list(owner.token, '?filter=new')).conversations).toHaveLength(2);
    const whatsappId = all.conversations[1].id;
    await req(ctx.app, 'POST', cp.read(BUSINESS_ID, whatsappId), owner.token);
    const unread = await list(owner.token, '?filter=unread');
    expect(unread.conversations.map((c: { id: string }) => c.id)).not.toContain(whatsappId);
    expect(unread.unreadCount).toBe(1);
    expect(
      (await req(ctx.app, 'GET', cp.unread(BUSINESS_ID), owner.token)).json().unreadCount,
    ).toBe(1);

    // A new customer message makes it unread again and moves it to the top.
    // (WhatsApp times are whole seconds: make it clearly the newest.)
    await post(whatsappText('עוד שאלה', undefined, undefined, 5));
    const after = await list(owner.token);
    expect(after.conversations[0]).toMatchObject({ id: whatsappId, unread: true });
  });

  it('opens a conversation, and a reply to a new sender makes them a customer', async () => {
    const owner = await setup();
    await post(facebookText('היי, אפשר לקבוע?'));
    const [convo] = (await list(owner.token)).conversations;

    const detail = (
      await req(ctx.app, 'GET', cp.detail(BUSINESS_ID, convo.id), owner.token)
    ).json();
    expect(detail.messages.map((m: { body: string }) => m.body)).toEqual(['היי, אפשר לקבוע?']);
    expect(detail.replyUntil).not.toBeNull();

    const sent = await req(ctx.app, 'POST', cp.messages(BUSINESS_ID, convo.id), owner.token, {
      text: 'בטח! מחר ב-10:00?',
    });
    expect(sent.statusCode).toBe(201);
    expect(messenger.sent).toEqual([
      expect.objectContaining({ to: '7766554433', text: 'בטח! מחר ב-10:00?' }),
    ]);
    // Business now: a Facebook lead, read, linked.
    const lead = await ctx.prisma.lead.findFirstOrThrow();
    expect(lead.source).toBe('facebook');
    const again = (await req(ctx.app, 'GET', cp.detail(BUSINESS_ID, convo.id), owner.token)).json();
    expect(again.conversation).toMatchObject({
      status: 'BUSINESS',
      leadId: lead.id,
      unread: false,
    });
    expect(again.messages.map((m: { direction: string }) => m.direction)).toEqual(['IN', 'OUT']);
  });

  it('replies through WhatsApp within 24 hours, and not after', async () => {
    const owner = await setup();
    await post(whatsappText('היי'));
    const [convo] = (await list(owner.token)).conversations;
    const ok = await req(ctx.app, 'POST', cp.messages(BUSINESS_ID, convo.id), owner.token, {
      text: 'שלום!',
    });
    expect(ok.statusCode).toBe(201);
    expect(whatsapp.sent.at(-1)).toMatchObject({ to: '+972501112233', text: 'שלום!' });

    await ctx.prisma.whatsAppMessage.updateMany({
      where: { direction: 'IN' },
      data: { createdAt: new Date(Date.now() - 25 * 3600_000) },
    });
    const late = await req(ctx.app, 'POST', cp.messages(BUSINESS_ID, convo.id), owner.token, {
      text: 'עדיין רלוונטי?',
    });
    expect(late.statusCode).toBe(409);
  });

  it('pages through long inboxes', async () => {
    const owner = await setup();
    for (let i = 0; i < CONVERSATIONS_PAGE + 2; i++) {
      await post(
        whatsappText(`הודעה ${i}`, `9725010000${String(i).padStart(2, '0')}`, `לקוח ${i}`),
      );
    }
    const first = await list(owner.token);
    expect(first.conversations).toHaveLength(CONVERSATIONS_PAGE);
    expect(first.nextCursor).not.toBeNull();
    const second = await list(owner.token, `?cursor=${first.nextCursor}`);
    expect(second.conversations).toHaveLength(2);
    expect(second.nextCursor).toBeNull();
    const ids = new Set([...first.conversations, ...second.conversations].map((c) => c.id));
    expect(ids.size).toBe(CONVERSATIONS_PAGE + 2);
  });

  it('only owners and managers use the inbox; unknown ids are 404', async () => {
    const owner = await setup();
    const employee = await newUser(ctx.app, 'inbox-emp');
    await addMember(ctx.prisma, BUSINESS_ID, employee.userId, 'EMPLOYEE');
    expect((await req(ctx.app, 'GET', cp.list(BUSINESS_ID), employee.token)).statusCode).toBe(403);
    expect(
      (
        await req(
          ctx.app,
          'GET',
          cp.detail(BUSINESS_ID, '00000000-0000-4000-8000-000000000000'),
          owner.token,
        )
      ).statusCode,
    ).toBe(404);
  });
});
