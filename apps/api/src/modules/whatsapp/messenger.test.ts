import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { apiPaths } from '@leadflow/shared';
import { createTestApp, resetDb, testConfig } from '../../../test/helpers';
import { addMember, newUser, req } from '../../../test/business-helpers';
import { MemoryMessengerSender } from '../../integrations/messenger';
import { MemoryWhatsAppSender, signWebhookBody } from '../../integrations/whatsapp';
import { MemoryEmailSender } from '../../integrations/email';
import { buildApp } from '../../app';

const BUSINESS_ID = '22222222-3333-4444-8555-666666666666';
const SECRET = 'test-app-secret-0123456789';
const PAGE_ID = '1122334455';
const PSID = '7766554433221100';
const wp = apiPaths.whatsapp;

let seq = 0;
const fbText = (text: string, psid = PSID, extra: object = {}) => {
  seq += 1;
  return {
    object: 'page',
    entry: [
      {
        id: PAGE_ID,
        messaging: [
          {
            sender: { id: psid },
            recipient: { id: PAGE_ID },
            timestamp: Date.now(),
            message: { mid: `m_test-${seq}-${Date.now()}`, text, ...extra },
          },
        ],
      },
    ],
  };
};

describe('Facebook Messenger → leads (F23)', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  const messenger = new MemoryMessengerSender();

  beforeAll(async () => {
    const config = testConfig({
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
      whatsappSender: new MemoryWhatsAppSender(),
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
    messenger.clear();
  });

  async function setup() {
    const owner = await newUser(ctx.app, 'fb-owner');
    await ctx.prisma.business.create({
      data: { id: BUSINESS_ID, name: 'מספרת שירן', industry: 'beauty', status: 'ACTIVE' },
    });
    await addMember(ctx.prisma, BUSINESS_ID, owner.userId, 'OWNER');
    return owner;
  }
  const post = (payload: object, signature?: string) => {
    const raw = JSON.stringify(payload);
    return ctx.app.inject({
      method: 'POST',
      url: wp.messengerWebhook,
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': signature ?? signWebhookBody(raw, SECRET),
      },
      payload: raw,
    });
  };

  it('answers the handshake with the shared verify token', async () => {
    const ok = await ctx.app.inject({
      method: 'GET',
      url: `${wp.messengerWebhook}?hub.mode=subscribe&hub.verify_token=verify-me-please&hub.challenge=42`,
    });
    expect(ok.body).toBe('42');
    const bad = await ctx.app.inject({
      method: 'GET',
      url: `${wp.messengerWebhook}?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=42`,
    });
    expect(bad.statusCode).toBe(403);
  });

  it('a new sender is a Facebook lead right away, with their Facebook name', async () => {
    const owner = await setup();
    messenger.names.set(PSID, 'דנה כהן');
    expect((await post(fbText('היי, יש תור למחר?'))).statusCode).toBe(200);
    // The same message delivered twice is stored once.
    const again = fbText('x');
    expect((await post(again)).statusCode).toBe(200);
    expect((await post(again)).statusCode).toBe(200);

    const inbox = (await req(ctx.app, 'GET', wp.inbox(BUSINESS_ID), owner.token)).json();
    expect(inbox.numbers).toHaveLength(0);
    const lead = await ctx.prisma.lead.findFirstOrThrow({ include: { contact: true } });
    expect(lead.source).toBe('facebook');
    expect(lead.contact).toMatchObject({ name: 'דנה כהן', phone: null });

    // Later messages join the same lead.
    await post(fbText('ומה המחיר?'));
    expect(await ctx.prisma.lead.count()).toBe(1);
    const thread = (await req(ctx.app, 'GET', wp.thread(BUSINESS_ID, lead.id), owner.token)).json();
    expect(thread.channel).toBe('messenger');
    expect(thread.messages.map((m: { body: string }) => m.body)).toEqual([
      'היי, יש תור למחר?',
      'x',
      'ומה המחיר?',
    ]);
    expect(thread.messages.every((m: { channel?: string }) => m.channel === 'messenger')).toBe(
      true,
    );
  });

  it('the team replies through Messenger within 24 hours, and not after', async () => {
    const owner = await setup();
    await post(fbText('היי'));
    const number = await ctx.prisma.whatsAppNumber.findFirstOrThrow();
    await req(ctx.app, 'POST', wp.classify(BUSINESS_ID, number.id), owner.token, {
      as: 'BUSINESS',
    });
    const lead = await ctx.prisma.lead.findFirstOrThrow();
    // No profile name shared: a neutral name.
    expect((await ctx.prisma.contact.findFirstOrThrow()).name).toBe('משתמש/ת פייסבוק');

    const sent = await req(ctx.app, 'POST', wp.thread(BUSINESS_ID, lead.id), owner.token, {
      text: 'שלום! יש מחר ב-10:00',
    });
    expect(sent.statusCode).toBe(201);
    expect(messenger.sent).toEqual([
      expect.objectContaining({ to: PSID, text: 'שלום! יש מחר ב-10:00' }),
    ]);

    await ctx.prisma.whatsAppMessage.updateMany({
      where: { direction: 'IN' },
      data: { createdAt: new Date(Date.now() - 25 * 3600_000) },
    });
    const late = await req(ctx.app, 'POST', wp.thread(BUSINESS_ID, lead.id), owner.token, {
      text: 'עדיין רלוונטי?',
    });
    expect(late.statusCode).toBe(409);
    expect(late.json().error.message).toMatch(/בפייסבוק רק עד 24 שעות/);
  });

  it('a sender marked personal earlier stays ignored', async () => {
    const owner = await setup();
    await ctx.prisma.whatsAppNumber.create({
      data: {
        businessId: BUSINESS_ID,
        channel: 'messenger',
        phone: `fb:${PSID}`,
        status: 'PERSONAL',
      },
    });
    await post(fbText('עוד משהו'));
    expect(await ctx.prisma.whatsAppMessage.count()).toBe(0);
    const personal = (await req(ctx.app, 'GET', wp.personal(BUSINESS_ID), owner.token)).json();
    expect(personal.numbers[0]).toMatchObject({ channel: 'messenger' });
  });

  it('rejects unsigned events, and skips echoes and other Pages', async () => {
    await setup();
    expect((await post(fbText('hi'), 'sha256=00')).statusCode).toBe(401);
    // The Page's own message (echo) and a message to another Page are ignored.
    await post(fbText('from the page', PSID, { is_echo: true }));
    const other = fbText('hi');
    other.entry[0]!.messaging[0]!.recipient.id = '999';
    await post(other);
    expect(await ctx.prisma.whatsAppMessage.count()).toBe(0);
    // A photo arrives as a label.
    await post(fbText('', PSID, { text: undefined, attachments: [{ type: 'image' }] }));
    expect((await ctx.prisma.whatsAppMessage.findFirstOrThrow()).body).toBe('[תמונה]');
  });

  it('only owners and managers see the inbox; employees only their leads', async () => {
    await setup();
    await post(fbText('היי'));
    const employee = await newUser(ctx.app, 'fb-emp');
    await addMember(ctx.prisma, BUSINESS_ID, employee.userId, 'EMPLOYEE');
    expect((await req(ctx.app, 'GET', wp.inbox(BUSINESS_ID), employee.token)).statusCode).toBe(403);
  });
});
