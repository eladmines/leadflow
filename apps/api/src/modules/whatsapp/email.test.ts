import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  apiPaths,
  EMAIL_SIGNATURE_HEADER,
  emailInboundPath,
  type EmailInbound,
} from '@leadflow/shared';
import { createTestApp, resetDb, testConfig } from '../../../test/helpers';
import { addMember, newUser, req } from '../../../test/business-helpers';
import { MemoryMessengerSender } from '../../integrations/messenger';
import { MemoryWhatsAppSender, signWebhookBody } from '../../integrations/whatsapp';
import { MemoryEmailSender } from '../../integrations/email';
import { buildApp } from '../../app';

const BUSINESS_ID = '22222222-3333-4444-8555-666666666666';
const DOMAIN = 'mail.leadflow.test';
const SECRET = 'inbound-secret-0123456789';

let seq = 0;
const mail = (over: Partial<EmailInbound> & { to: string }): Record<string, unknown> => {
  seq += 1;
  return {
    from: 'dana@example.com',
    fromName: 'דנה כהן',
    subject: 'תור ליום חמישי',
    text: 'היי, אפשר תור ליום חמישי?',
    messageId: `<msg-${seq}-${Date.now()}@example.com>`,
    ...over,
  };
};

describe('Email conversations (F27)', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  const email = new MemoryEmailSender();
  /** What went out to the customer (sign-up mail aside). */
  const toDana = () => email.to('dana@example.com');

  beforeAll(async () => {
    const config = testConfig({
      EMAIL_INBOUND_DOMAIN: DOMAIN,
      EMAIL_INBOUND_SECRET: SECRET,
      EMAIL_TRANSPORT: 'memory',
    });
    const base = await createTestApp({ config });
    await base.app.close();
    const app = await buildApp({
      config,
      prisma: base.prisma,
      emailSender: email,
      whatsappSender: new MemoryWhatsAppSender(),
      messengerSender: new MemoryMessengerSender(),
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
    email.clear();
  });

  async function setup() {
    const owner = await newUser(ctx.app, 'mail-owner');
    await ctx.prisma.business.create({
      data: { id: BUSINESS_ID, name: 'מספרת שירן', industry: 'beauty', status: 'ACTIVE' },
    });
    await addMember(ctx.prisma, BUSINESS_ID, owner.userId, 'OWNER');
    const res = await req(ctx.app, 'POST', apiPaths.channels.email(BUSINESS_ID), owner.token);
    const address = res.json().email.name as string;
    return { owner, address };
  }
  const post = (payload: object, signature?: string) => {
    const raw = JSON.stringify(payload);
    return ctx.app.inject({
      method: 'POST',
      url: emailInboundPath,
      headers: {
        'content-type': 'application/json',
        [EMAIL_SIGNATURE_HEADER]: signature ?? signWebhookBody(raw, SECRET),
      },
      payload: raw,
    });
  };
  const leadsOf = async (token: string) =>
    (await req(ctx.app, 'GET', apiPaths.leads.list(BUSINESS_ID), token)).json().leads;
  const conversations = async (token: string) =>
    (await req(ctx.app, 'GET', apiPaths.conversations.list(BUSINESS_ID), token)).json();

  it('creates the forwarding address once, for the owner only', async () => {
    const { owner, address } = await setup();
    expect(address).toMatch(new RegExp(`^[a-z0-9]{10}@${DOMAIN.replace(/\./g, '\\.')}$`));
    const again = await req(ctx.app, 'POST', apiPaths.channels.email(BUSINESS_ID), owner.token);
    expect(again.json().email).toMatchObject({ connected: true, name: address });
    expect(again.json().emailInbound).toBe(true);

    const employee = await newUser(ctx.app, 'mail-emp');
    await addMember(ctx.prisma, BUSINESS_ID, employee.userId, 'EMPLOYEE');
    const denied = await req(ctx.app, 'POST', apiPaths.channels.email(BUSINESS_ID), employee.token);
    expect(denied.statusCode).toBe(403);
  });

  it('an email becomes a lead and a conversation; the next one joins it', async () => {
    const { owner, address } = await setup();
    expect((await post(mail({ to: address }))).statusCode).toBe(200);
    expect(
      (await post(mail({ to: address, subject: 'Re: תור', text: 'ובשעה 10?' }))).statusCode,
    ).toBe(200);

    const leads = await leadsOf(owner.token);
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({
      source: 'email',
      contact: { name: 'דנה כהן', email: 'dana@example.com', phone: null },
    });
    const list = await conversations(owner.token);
    expect(list.conversations).toHaveLength(1);
    expect(list.conversations[0]).toMatchObject({
      channel: 'email',
      email: 'dana@example.com',
      name: 'דנה כהן',
      status: 'BUSINESS',
      leadId: leads[0].id,
      unread: true,
    });
    const detail = (
      await req(
        ctx.app,
        'GET',
        apiPaths.conversations.detail(BUSINESS_ID, list.conversations[0].id),
        owner.token,
      )
    ).json();
    expect(detail.messages.map((m: { body: string }) => m.body)).toEqual([
      'היי, אפשר תור ליום חמישי?',
      'ובשעה 10?',
    ]);
    expect(detail.messages[0]).toMatchObject({ channel: 'email', subject: 'תור ליום חמישי' });
    const note = await ctx.prisma.notification.findFirst({
      where: { userId: owner.userId, type: 'lead.new' },
    });
    expect(note?.data).toMatchObject({ source: 'email' });
  });

  it('cuts quoted text and ignores auto-mail, loops, repeats and unknown addresses', async () => {
    const { owner, address } = await setup();
    const quoted = mail({
      to: address,
      text: 'תודה רבה!\n\nב-10.11.2026 כתבה מספרת שירן:\n> מחר ב-10:00\n> מתאים?',
    });
    await post(quoted);
    await post(quoted);
    await post(mail({ to: address, autoSubmitted: true }));
    await post(mail({ to: address, from: `loop@${DOMAIN}` }));
    await post(mail({ to: 'nobody@' + DOMAIN }));
    const [convo] = (await conversations(owner.token)).conversations;
    const detail = (
      await req(ctx.app, 'GET', apiPaths.conversations.detail(BUSINESS_ID, convo.id), owner.token)
    ).json();
    expect(detail.messages.map((m: { body: string }) => m.body)).toEqual(['תודה רבה!']);
    expect(await ctx.prisma.lead.count()).toBe(1);
  });

  it('rejects unsigned or wrongly signed requests and stores nothing', async () => {
    const { address } = await setup();
    expect((await post(mail({ to: address }), 'sha256=00')).statusCode).toBe(401);
    const noHeader = await ctx.app.inject({
      method: 'POST',
      url: emailInboundPath,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify(mail({ to: address })),
    });
    expect(noHeader.statusCode).toBe(401);
    expect(await ctx.prisma.whatsAppMessage.count()).toBe(0);
  });

  it('a reply goes out from the forwarding address, threaded, with no 24-hour window', async () => {
    const { owner, address } = await setup();
    await post(mail({ to: address, messageId: '<abc123@example.com>' }));
    const [convo] = (await conversations(owner.token)).conversations;
    await ctx.prisma.whatsAppMessage.updateMany({
      data: { createdAt: new Date(Date.now() - 72 * 3600_000) },
    });

    const sent = await req(
      ctx.app,
      'POST',
      apiPaths.conversations.messages(BUSINESS_ID, convo.id),
      owner.token,
      { text: 'בטח! מחר ב-10:00 <b>מתאים?</b>' },
    );
    expect(sent.statusCode).toBe(201);
    expect(toDana()).toHaveLength(1);
    expect(toDana()[0]).toMatchObject({
      to: 'dana@example.com',
      from: `מספרת שירן <${address}>`,
      replyTo: address,
      inReplyTo: '<abc123@example.com>',
      subject: 'Re: תור ליום חמישי',
      text: 'בטח! מחר ב-10:00 <b>מתאים?</b>',
    });
    expect(toDana()[0]!.html).toContain('&lt;b&gt;');

    // Replying again keeps one "Re:".
    await post(mail({ to: address, subject: 'Re: תור ליום חמישי', text: 'מצוין' }));
    await req(
      ctx.app,
      'POST',
      apiPaths.conversations.messages(BUSINESS_ID, convo.id),
      owner.token,
      {
        text: 'נתראה',
      },
    );
    expect(toDana()[1]!.subject).toBe('Re: תור ליום חמישי');

    // The same reply from the lead page works too.
    const [lead] = await leadsOf(owner.token);
    const fromLead = await req(
      ctx.app,
      'POST',
      apiPaths.whatsapp.thread(BUSINESS_ID, lead.id),
      owner.token,
      { text: 'עוד דבר קטן' },
    );
    expect(fromLead.statusCode).toBe(201);
    expect(toDana()).toHaveLength(3);
  });

  it('refuses a reply when the server sends no email, without leaking provider details', async () => {
    const { owner, address } = await setup();
    await post(mail({ to: address }));
    const [convo] = (await conversations(owner.token)).conversations;
    const config = ctx.app.config as { EMAIL_TRANSPORT: string };
    config.EMAIL_TRANSPORT = 'disabled';
    try {
      const res = await req(
        ctx.app,
        'POST',
        apiPaths.conversations.messages(BUSINESS_ID, convo.id),
        owner.token,
        { text: 'שלום' },
      );
      expect(res.statusCode).toBe(409);
      expect(res.json().error.message).toMatch(/שליחת מייל עוד לא הוגדרה/);
    } finally {
      config.EMAIL_TRANSPORT = 'memory';
    }
    email.failWith = new Error('provider exploded: key=secret');
    const failed = await req(
      ctx.app,
      'POST',
      apiPaths.conversations.messages(BUSINESS_ID, convo.id),
      owner.token,
      { text: 'שלום' },
    );
    expect(failed.statusCode).toBe(500);
    expect(JSON.stringify(failed.json())).not.toMatch(/exploded|secret/);
  });
});
