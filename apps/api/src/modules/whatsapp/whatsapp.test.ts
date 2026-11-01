import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { apiPaths, whatsappMessages } from '@leadflow/shared';
import { createTestApp, resetDb, testConfig } from '../../../test/helpers';
import { addMember, newUser, ownerWithBusiness, req } from '../../../test/business-helpers';
import { loadConfig } from '../../config/env';
import {
  CloudWhatsAppSender,
  MemoryWhatsAppSender,
  signWebhookBody,
  WhatsAppSendError,
} from '../../integrations/whatsapp';
import { buildApp } from '../../app';
import { MemoryEmailSender } from '../../integrations/email';

const BUSINESS_ID = '11111111-2222-4333-8444-555555555555';
const SECRET = 'test-app-secret-0123456789';
const VERIFY = 'verify-me-please';
const PHONE_ID = '1234567890';
const wp = apiPaths.whatsapp;
const lp = apiPaths.leads;

let seq = 0;
/** A Meta webhook payload with one text message. */
function textEvent(
  from: string,
  text: string,
  opts: { name?: string; id?: string; at?: Date; phoneId?: string } = {},
) {
  seq += 1;
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'waba',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: '15550001111',
                phone_number_id: opts.phoneId ?? PHONE_ID,
              },
              contacts: [{ wa_id: from, profile: { name: opts.name ?? 'דנה כהן' } }],
              messages: [
                {
                  from,
                  id: opts.id ?? `wamid.test-${seq}-${Date.now()}`,
                  timestamp: String(Math.floor((opts.at ?? new Date()).getTime() / 1000)),
                  type: 'text',
                  text: { body: text },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

function statusEvent(id: string, status: string) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        changes: [
          {
            field: 'messages',
            value: { metadata: { phone_number_id: PHONE_ID }, statuses: [{ id, status }] },
          },
        ],
      },
    ],
  };
}

describe('WhatsApp (F12 POC)', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  const whatsapp = new MemoryWhatsAppSender();

  beforeAll(async () => {
    const config = testConfig({
      WHATSAPP_BUSINESS_ID: BUSINESS_ID,
      WHATSAPP_APP_SECRET: SECRET,
      WHATSAPP_VERIFY_TOKEN: VERIFY,
      WHATSAPP_PHONE_NUMBER_ID: PHONE_ID,
    });
    const base = await createTestApp({ config });
    await base.app.close();
    // Rebuilt with the memory WhatsApp sender so tests can read what was "sent".
    const app = await buildApp({
      config,
      prisma: base.prisma,
      emailSender: new MemoryEmailSender(),
      whatsappSender: whatsapp,
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
  });

  /** The connected business (fixed id) with its owner. */
  async function connected() {
    const owner = await newUser(ctx.app, 'wa-owner');
    await ctx.prisma.business.create({
      data: { id: BUSINESS_ID, name: 'עיצוב שיער סיגלית', industry: 'beauty', status: 'ACTIVE' },
    });
    await addMember(ctx.prisma, BUSINESS_ID, owner.userId, 'OWNER');
    return owner;
  }

  /** Marks the test customer's number as a business number (as if classified earlier). */
  const customer = (phone = '+972501112233') =>
    ctx.prisma.whatsAppNumber.create({
      data: { businessId: BUSINESS_ID, phone, status: 'BUSINESS' },
    });

  const post = (payload: object, signature?: string | null) => {
    const raw = JSON.stringify(payload);
    return ctx.app.inject({
      method: 'POST',
      url: wp.webhook,
      headers: {
        'content-type': 'application/json',
        ...(signature === null
          ? {}
          : { 'x-hub-signature-256': signature ?? signWebhookBody(raw, SECRET) }),
      },
      payload: raw,
    });
  };

  const leadsOf = async (token: string) =>
    (await req(ctx.app, 'GET', lp.list(BUSINESS_ID), token)).json().leads;

  it("answers Meta's verification handshake only with the right token", async () => {
    const ok = await ctx.app.inject({
      method: 'GET',
      url: `${wp.webhook}?hub.mode=subscribe&hub.verify_token=${VERIFY}&hub.challenge=12345`,
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toBe('12345');
    const bad = await ctx.app.inject({
      method: 'GET',
      url: `${wp.webhook}?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=12345`,
    });
    expect(bad.statusCode).toBe(403);
  });

  it('rejects events without a valid signature and stores nothing', async () => {
    await connected();
    expect((await post(textEvent('972501112233', 'היי'), null)).statusCode).toBe(401);
    expect((await post(textEvent('972501112233', 'היי'), 'sha256=00ff')).statusCode).toBe(401);
    expect(await ctx.prisma.whatsAppMessage.count()).toBe(0);
    expect(await ctx.prisma.lead.count()).toBe(0);
  });

  it('messages from a business number become a WhatsApp lead with the conversation', async () => {
    const owner = await connected();
    await customer();
    const res = await post(textEvent('972501112233', 'היי, אפשר לקבוע תספורת לשבוע הבא?'));
    expect(res.statusCode).toBe(200);

    const [lead] = await leadsOf(owner.token);
    expect(lead).toMatchObject({
      source: 'whatsapp',
      message: 'היי, אפשר לקבוע תספורת לשבוע הבא?',
      contact: { name: 'דנה כהן', phone: '+972501112233' },
      stage: { name: 'חדש' },
      lastWhatsApp: { direction: 'IN', body: 'היי, אפשר לקבוע תספורת לשבוע הבא?' },
    });
    const thread = (await req(ctx.app, 'GET', wp.thread(BUSINESS_ID, lead.id), owner.token)).json();
    expect(thread.connected).toBe(true);
    expect(thread.messages).toEqual([
      expect.objectContaining({
        direction: 'IN',
        body: 'היי, אפשר לקבוע תספורת לשבוע הבא?',
        status: 'received',
      }),
    ]);
    expect(new Date(thread.replyUntil).getTime()).toBeGreaterThan(Date.now() + 23 * 3600_000);
  });

  it('ignores Meta retries of the same message', async () => {
    const owner = await connected();
    await customer();
    const event = textEvent('972501112233', 'שלום', { id: 'wamid.same' });
    await post(event);
    await post(event);
    expect(await ctx.prisma.whatsAppMessage.count()).toBe(1);
    expect(await leadsOf(owner.token)).toHaveLength(1);
  });

  it('keeps a contact on its open lead, and opens a new one after it is closed', async () => {
    const owner = await connected();
    await customer();
    await post(textEvent('972501112233', 'היי'));
    await post(textEvent('972501112233', 'עוד שאלה'));
    const leads = await leadsOf(owner.token);
    expect(leads).toHaveLength(1);
    // A new lead, then a message on it (D-097).
    const notes = await ctx.prisma.notification.findMany({ orderBy: { createdAt: 'asc' } });
    expect(notes.map((n) => n.type)).toEqual(['lead.new', 'whatsapp.message']);
    expect(notes[1]!.data).toMatchObject({ leadId: leads[0].id, preview: 'עוד שאלה' });

    const won = await ctx.prisma.pipelineStage.findFirstOrThrow({
      where: { businessId: BUSINESS_ID, kind: 'WON' },
    });
    await req(ctx.app, 'PATCH', lp.detail(BUSINESS_ID, leads[0].id), owner.token, {
      stageId: won.id,
    });
    await post(textEvent('972501112233', 'רוצה לקבוע שוב'));
    expect(await leadsOf(owner.token)).toHaveLength(2);
    // The thread is per customer, so both leads show the whole conversation.
    const thread = (
      await req(ctx.app, 'GET', wp.thread(BUSINESS_ID, leads[0].id), owner.token)
    ).json();
    expect(thread.messages).toHaveLength(3);
  });

  it('reuses an existing contact with the same phone', async () => {
    const owner = await connected();
    await req(ctx.app, 'POST', lp.list(BUSINESS_ID), owner.token, {
      name: 'מיכל לוי',
      phone: '050-1112233',
    });
    const manual = (await leadsOf(owner.token))[0];
    await req(ctx.app, 'PATCH', lp.detail(BUSINESS_ID, manual.id), owner.token, {
      stageId: (
        await ctx.prisma.pipelineStage.findFirstOrThrow({
          where: { businessId: BUSINESS_ID, kind: 'LOST' },
        })
      ).id,
    });
    await post(textEvent('972501112233', 'היי', { name: 'Michal' }));
    const leads = await leadsOf(owner.token);
    expect(leads).toHaveLength(2);
    expect(leads[0].contact).toMatchObject({ id: manual.contact.id, name: 'מיכל לוי' });
    expect(await ctx.prisma.contact.count()).toBe(1);
  });

  it('replies inside the 24-hour window and tracks delivery', async () => {
    const owner = await connected();
    await customer();
    await post(textEvent('972501112233', 'היי'));
    const [lead] = await leadsOf(owner.token);

    const res = await req(ctx.app, 'POST', wp.thread(BUSINESS_ID, lead.id), owner.token, {
      text: 'היי דנה! יש מקום ביום שלישי ב-10:00',
    });
    expect(res.statusCode).toBe(201);
    expect(whatsapp.sent).toEqual([
      expect.objectContaining({ to: '+972501112233', text: 'היי דנה! יש מקום ביום שלישי ב-10:00' }),
    ]);
    const sentId = whatsapp.sent[0]!.id;
    expect(res.json().message).toMatchObject({
      direction: 'OUT',
      status: 'sent',
      sender: { id: owner.userId },
    });

    await post(statusEvent(sentId, 'read'));
    await post(statusEvent(sentId, 'delivered')); // late receipt must not move it back
    const thread = (await req(ctx.app, 'GET', wp.thread(BUSINESS_ID, lead.id), owner.token)).json();
    expect(thread.messages.map((m: { status: string }) => m.status)).toEqual(['received', 'read']);
    // The list preview follows the conversation.
    expect((await leadsOf(owner.token))[0].lastWhatsApp).toMatchObject({
      direction: 'OUT',
      body: 'היי דנה! יש מקום ביום שלישי ב-10:00',
    });
  });

  it('refuses free-form replies once the window has closed', async () => {
    const owner = await connected();
    await customer();
    await post(textEvent('972501112233', 'היי', { at: new Date(Date.now() - 25 * 3600_000) }));
    const [lead] = await leadsOf(owner.token);
    const thread = (await req(ctx.app, 'GET', wp.thread(BUSINESS_ID, lead.id), owner.token)).json();
    expect(thread.replyUntil).toBeNull();
    const res = await req(ctx.app, 'POST', wp.thread(BUSINESS_ID, lead.id), owner.token, {
      text: 'היי',
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.message).toBe(whatsappMessages.windowClosed);
    expect(whatsapp.sent).toHaveLength(0);
  });

  it('reports a failed send without storing it or leaking provider details', async () => {
    const owner = await connected();
    await customer();
    await post(textEvent('972501112233', 'היי'));
    const [lead] = await leadsOf(owner.token);
    whatsapp.failWith = new WhatsAppSendError(400, 131047);
    const res = await req(ctx.app, 'POST', wp.thread(BUSINESS_ID, lead.id), owner.token, {
      text: 'היי',
    });
    expect(res.statusCode).toBe(500);
    expect(res.json().error.message).toBe(whatsappMessages.sendFailed);
    expect(res.body).not.toContain('131047');
    expect(await ctx.prisma.whatsAppMessage.count({ where: { direction: 'OUT' } })).toBe(0);
  });

  it('validates the reply text', async () => {
    const owner = await connected();
    await customer();
    await post(textEvent('972501112233', 'היי'));
    const [lead] = await leadsOf(owner.token);
    const res = await req(ctx.app, 'POST', wp.thread(BUSINESS_ID, lead.id), owner.token, {
      text: '  ',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.fields.text).toBe(whatsappMessages.textRequired);
  });

  it('ignores events for another phone number', async () => {
    await connected();
    await post(textEvent('972501112233', 'היי', { phoneId: '999' }));
    expect(await ctx.prisma.whatsAppMessage.count()).toBe(0);
  });

  it('employees only see conversations on leads assigned to them', async () => {
    const owner = await connected();
    await customer();
    const employee = await newUser(ctx.app, 'wa-emp');
    await addMember(ctx.prisma, BUSINESS_ID, employee.userId, 'EMPLOYEE');
    await post(textEvent('972501112233', 'היי'));
    const [lead] = await leadsOf(owner.token);

    const url = wp.thread(BUSINESS_ID, lead.id);
    expect((await req(ctx.app, 'GET', url, employee.token)).statusCode).toBe(404);
    expect((await req(ctx.app, 'POST', url, employee.token, { text: 'היי' })).statusCode).toBe(404);
    await req(ctx.app, 'PATCH', lp.detail(BUSINESS_ID, lead.id), owner.token, {
      ownerId: employee.userId,
    });
    expect((await req(ctx.app, 'GET', url, employee.token)).statusCode).toBe(200);
    expect((await req(ctx.app, 'POST', url, employee.token, { text: 'היי' })).statusCode).toBe(201);
  });

  describe('number classification (D-092)', () => {
    const inboxOf = async (token: string) =>
      (await req(ctx.app, 'GET', wp.inbox(BUSINESS_ID), token)).json();
    const classify = (token: string, numberId: string, as: 'BUSINESS' | 'PERSONAL') =>
      req(ctx.app, 'POST', wp.classify(BUSINESS_ID, numberId), token, { as });

    it('a new number waits in the inbox: no contact, no lead', async () => {
      const owner = await connected();
      await post(textEvent('972541234567', 'היי, יש תור מחר?', { name: 'נועה' }));
      await post(textEvent('972541234567', 'בבוקר אם אפשר', { name: 'נועה' }));

      expect(await leadsOf(owner.token)).toHaveLength(0);
      expect(await ctx.prisma.contact.count()).toBe(0);
      // One notification for the new number, not one per message (D-097).
      const notes = await ctx.prisma.notification.findMany();
      expect(notes).toHaveLength(1);
      expect(notes[0]).toMatchObject({ type: 'whatsapp.new_number', userId: owner.userId });
      const inbox = await inboxOf(owner.token);
      expect(inbox.connected).toBe(true);
      expect(inbox.numbers).toEqual([
        expect.objectContaining({
          phone: '+972541234567',
          profileName: 'נועה',
          messages: [
            expect.objectContaining({ body: 'היי, יש תור מחר?' }),
            expect.objectContaining({ body: 'בבוקר אם אפשר' }),
          ],
        }),
      ]);
    });

    it('marking a number business creates the contact and lead, and remembers it', async () => {
      const owner = await connected();
      await post(textEvent('972541234567', 'היי, יש תור מחר?', { name: 'נועה' }));
      await post(textEvent('972541234567', 'בבוקר אם אפשר', { name: 'נועה' }));
      const [number] = (await inboxOf(owner.token)).numbers;

      const res = await classify(owner.token, number.id, 'BUSINESS');
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ status: 'BUSINESS', leadId: expect.any(String) });
      const [lead] = await leadsOf(owner.token);
      expect(lead).toMatchObject({
        id: res.json().leadId,
        source: 'whatsapp',
        message: 'היי, יש תור מחר?\nבבוקר אם אפשר',
        contact: { name: 'נועה', phone: '+972541234567' },
      });
      const thread = (
        await req(ctx.app, 'GET', wp.thread(BUSINESS_ID, lead.id), owner.token)
      ).json();
      expect(thread.messages).toHaveLength(2);
      expect((await inboxOf(owner.token)).numbers).toHaveLength(0);

      // Remembered: the next message goes straight to the same lead.
      await post(textEvent('972541234567', 'תודה!'));
      expect(await leadsOf(owner.token)).toHaveLength(1);
      expect((await inboxOf(owner.token)).numbers).toHaveLength(0);
      expect(await ctx.prisma.whatsAppMessage.count({ where: { leadId: lead.id } })).toBe(3);
    });

    it('marking a number personal deletes its messages and ignores it from then on', async () => {
      const owner = await connected();
      await post(textEvent('972541234567', 'מה נשמע אחי?', { name: 'אמא' }));
      const [number] = (await inboxOf(owner.token)).numbers;

      const res = await classify(owner.token, number.id, 'PERSONAL');
      expect(res.json()).toMatchObject({ status: 'PERSONAL', leadId: null });
      expect(await ctx.prisma.whatsAppMessage.count()).toBe(0);
      const row = await ctx.prisma.whatsAppNumber.findUniqueOrThrow({ where: { id: number.id } });
      expect(row).toMatchObject({
        status: 'PERSONAL',
        profileName: null,
        classifiedById: owner.userId,
      });

      await post(textEvent('972541234567', 'מתי אתה בא לארוחה?'));
      expect(await ctx.prisma.whatsAppMessage.count()).toBe(0);
      expect((await inboxOf(owner.token)).numbers).toHaveLength(0);
      expect(await leadsOf(owner.token)).toHaveLength(0);

      const personal = (await req(ctx.app, 'GET', wp.personal(BUSINESS_ID), owner.token)).json();
      expect(personal.numbers).toEqual([
        expect.objectContaining({ id: number.id, phone: '+972541234567' }),
      ]);
    });

    it('a personal marking can be undone; the next message waits in the inbox again', async () => {
      const owner = await connected();
      await post(textEvent('972541234567', 'היי'));
      const [number] = (await inboxOf(owner.token)).numbers;
      await classify(owner.token, number.id, 'PERSONAL');

      const del = await req(ctx.app, 'DELETE', wp.number(BUSINESS_ID, number.id), owner.token);
      expect(del.statusCode).toBe(204);
      await post(textEvent('972541234567', 'עכשיו אני רוצה תור'));
      expect((await inboxOf(owner.token)).numbers).toEqual([
        expect.objectContaining({ phone: '+972541234567' }),
      ]);
    });

    it('a customer cannot be marked personal, and only personal markings can be undone', async () => {
      const owner = await connected();
      const number = await customer();
      const res = await classify(owner.token, number.id, 'PERSONAL');
      expect(res.statusCode).toBe(409);
      expect(res.json().error.message).toBe(whatsappMessages.alreadyCustomer);
      const del = await req(ctx.app, 'DELETE', wp.number(BUSINESS_ID, number.id), owner.token);
      expect(del.statusCode).toBe(409);
      expect(del.json().error.message).toBe(whatsappMessages.notPersonal);
    });

    it('deleting a lead forgets its WhatsApp number and messages', async () => {
      const owner = await connected();
      await customer();
      await post(textEvent('972501112233', 'היי'));
      const [lead] = await leadsOf(owner.token);
      await req(ctx.app, 'DELETE', lp.detail(BUSINESS_ID, lead.id), owner.token);
      expect(await ctx.prisma.whatsAppNumber.count()).toBe(0);
      expect(await ctx.prisma.whatsAppMessage.count()).toBe(0);
    });

    it('only owners and managers see and classify the inbox; other businesses get 404', async () => {
      const owner = await connected();
      const manager = await newUser(ctx.app, 'wa-mgr');
      const employee = await newUser(ctx.app, 'wa-emp2');
      await addMember(ctx.prisma, BUSINESS_ID, manager.userId, 'MANAGER');
      await addMember(ctx.prisma, BUSINESS_ID, employee.userId, 'EMPLOYEE');
      await post(textEvent('972541234567', 'היי'));
      const [number] = (await inboxOf(owner.token)).numbers;

      expect((await req(ctx.app, 'GET', wp.inbox(BUSINESS_ID), employee.token)).statusCode).toBe(
        403,
      );
      expect((await classify(employee.token, number.id, 'BUSINESS')).statusCode).toBe(403);
      expect((await req(ctx.app, 'GET', wp.inbox(BUSINESS_ID), manager.token)).statusCode).toBe(
        200,
      );

      const other = await ownerWithBusiness(ctx.app, 'wa-other');
      const foreign = await req(
        ctx.app,
        'POST',
        wp.classify(other.business.id, number.id),
        other.token,
        { as: 'PERSONAL' },
      );
      expect(foreign.statusCode).toBe(404);
      expect(await ctx.prisma.whatsAppMessage.count()).toBe(1);
    });
  });

  it('a business without WhatsApp sees it as not connected and cannot send', async () => {
    await connected();
    const other = await ownerWithBusiness(ctx.app, 'other');
    const id = other.business.id;
    const lead = (
      await req(ctx.app, 'POST', lp.list(id), other.token, { name: 'רון', phone: '052-1112233' })
    ).json().lead;
    const thread = (await req(ctx.app, 'GET', wp.thread(id, lead.id), other.token)).json();
    expect(thread).toMatchObject({ connected: false, messages: [], replyUntil: null });
    const res = await req(ctx.app, 'POST', wp.thread(id, lead.id), other.token, { text: 'היי' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.message).toBe(whatsappMessages.notConnected);
  });
});

describe('WhatsApp webhook when not configured', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());

  it('is not found and never verifies', async () => {
    const post = await ctx.app.inject({ method: 'POST', url: wp.webhook, payload: {} });
    expect(post.statusCode).toBe(404);
    const get = await ctx.app.inject({
      method: 'GET',
      url: `${wp.webhook}?hub.mode=subscribe&hub.verify_token=undefined&hub.challenge=1`,
    });
    expect(get.statusCode).toBe(403);
  });
});

describe('WhatsApp configuration and Cloud API adapter', () => {
  it('requires the secrets once a business is connected', () => {
    const base = { NODE_ENV: 'test', DATABASE_URL: 'postgresql://x:y@localhost:5432/z' };
    expect(() => loadConfig({ ...base, WHATSAPP_BUSINESS_ID: BUSINESS_ID })).toThrow(
      /WHATSAPP_APP_SECRET.*WHATSAPP_VERIFY_TOKEN/,
    );
    expect(() =>
      loadConfig({
        ...base,
        WHATSAPP_BUSINESS_ID: BUSINESS_ID,
        WHATSAPP_APP_SECRET: SECRET,
        WHATSAPP_VERIFY_TOKEN: VERIFY,
        WHATSAPP_PROVIDER: 'cloud',
      }),
    ).toThrow(/WHATSAPP_PHONE_NUMBER_ID/);
  });

  it('sends a text through the Graph API', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ messages: [{ id: 'wamid.abc' }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const sender = new CloudWhatsAppSender({
      phoneNumberId: PHONE_ID,
      accessToken: 'tok',
      graphVersion: 'v21.0',
      fetch: fakeFetch,
    });
    expect(await sender.sendText('+972501112233', 'היי')).toEqual({ id: 'wamid.abc' });
    expect(calls[0]!.url).toBe(`https://graph.facebook.com/v21.0/${PHONE_ID}/messages`);
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer tok');
    expect(JSON.parse(calls[0]!.init.body as string)).toMatchObject({
      messaging_product: 'whatsapp',
      to: '972501112233',
      type: 'text',
      text: { body: 'היי' },
    });
  });

  it('turns a Meta error into a WhatsAppSendError with only the code', async () => {
    const fakeFetch = (async () =>
      new Response(
        JSON.stringify({ error: { code: 131047, message: 'Re-engagement message for +972…' } }),
        { status: 400 },
      )) as unknown as typeof fetch;
    const sender = new CloudWhatsAppSender({
      phoneNumberId: PHONE_ID,
      accessToken: 'tok',
      graphVersion: 'v21.0',
      fetch: fakeFetch,
    });
    const err = await sender.sendText('+972501112233', 'היי').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WhatsAppSendError);
    expect(err).toMatchObject({ status: 400, code: 131047 });
    expect(String((err as Error).message)).not.toContain('972');
  });
});
