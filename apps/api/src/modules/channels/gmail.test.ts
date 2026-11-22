import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { apiPaths } from '@simplecatch/shared';
import { createTestApp, resetDb, testConfig } from '../../../test/helpers';
import { newUser, ownerWithBusiness, req } from '../../../test/business-helpers';
import { MemoryGmailApi, toMessage, type GmailMessage } from '../../integrations/gmail';
import { MemoryMessengerSender } from '../../integrations/messenger';
import { MemoryWhatsAppSender } from '../../integrations/whatsapp';
import { MemoryEmailSender } from '../../integrations/email';
import { WhatsAppService } from '../whatsapp/service';
import { buildApp } from '../../app';

const ch = apiPaths.channels;
const wp = apiPaths.whatsapp;

let seq = 0;
const mail = (over: Partial<GmailMessage> = {}): GmailMessage => {
  seq += 1;
  return {
    id: `g${seq}`,
    threadId: `t${seq}`,
    messageId: `msg-${seq}@example.com`,
    from: 'dana@example.com',
    fromName: 'דנה כהן',
    subject: 'תור ליום חמישי',
    text: 'היי, אפשר תור ליום חמישי?',
    receivedAt: Date.now() + seq * 1000,
    skip: false,
    ...over,
  };
};

describe('Gmail conversations (F29)', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  const gmail = new MemoryGmailApi();
  const sender = new MemoryWhatsAppSender();
  const messenger = new MemoryMessengerSender();
  const email = new MemoryEmailSender();
  let sync: () => Promise<number>;

  beforeAll(async () => {
    const config = testConfig({
      GOOGLE_CLIENT_ID: 'google-client-id-0123',
      GOOGLE_CLIENT_SECRET: 'google-client-secret-0123',
    });
    const base = await createTestApp({ config });
    await base.app.close();
    const app = await buildApp({
      config,
      prisma: base.prisma,
      emailSender: email,
      whatsappSender: sender,
      messengerSender: messenger,
      gmailApi: gmail,
    });
    await app.ready();
    sync = () =>
      new WhatsAppService(
        app.prisma,
        config,
        sender,
        app.log,
        app.storage,
        messenger,
        email,
        gmail,
      ).syncGmail();
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
    gmail.clear();
    email.clear?.();
  });

  /** Connects the owner's Gmail through the sign-in, as the browser would. */
  async function connect(label: string) {
    const o = await ownerWithBusiness(ctx.app, label);
    const start = (await req(ctx.app, 'GET', ch.gmailStart(o.business.id), o.token)).json();
    const state = new URL(start.url).searchParams.get('state')!;
    const back = await ctx.app.inject({
      method: 'GET',
      url: `${ch.gmailCallback}?code=good-code&state=${encodeURIComponent(state)}`,
    });
    return { o, back };
  }

  it('connects through Google: the token sealed, the address shown, nothing old imported', async () => {
    const o = await ownerWithBusiness(ctx.app, 'gm-owner');
    const before = (await req(ctx.app, 'GET', ch.list(o.business.id), o.token)).json();
    expect(before).toMatchObject({ gmail: { connected: false }, gmailLogin: true });

    // An old message is already in the inbox when the owner connects.
    gmail.inbox.push(mail({ receivedAt: Date.now() - 60_000 }));
    const start = (await req(ctx.app, 'GET', ch.gmailStart(o.business.id), o.token)).json();
    const state = new URL(start.url).searchParams.get('state')!;
    const back = await ctx.app.inject({
      method: 'GET',
      url: `${ch.gmailCallback}?code=good-code&state=${encodeURIComponent(state)}`,
    });
    expect(back.statusCode).toBe(302);
    const location = new URL(back.headers.location as string);
    expect(location.pathname).toBe(`/b/${o.business.id}/settings`);
    expect(location.searchParams.get('gmail')).toBe('connected');

    const after = (await req(ctx.app, 'GET', ch.list(o.business.id), o.token)).json();
    expect(after.gmail).toEqual({
      channel: 'email',
      connected: true,
      name: 'owner@gmail.com',
      source: 'business',
    });
    const row = await ctx.prisma.channelConnection.findFirstOrThrow({
      where: { channel: 'gmail' },
    });
    expect(row.tokenEncrypted).not.toContain('refresh-token');
    expect(JSON.stringify(after)).not.toContain('refresh-token');

    expect(await sync()).toBe(0);
    expect(await ctx.prisma.whatsAppMessage.count()).toBe(0);
  });

  it('a forged or failed sign-in goes nowhere; an address belongs to one business', async () => {
    const o = await ownerWithBusiness(ctx.app, 'gm-forged');
    const forged = await ctx.app.inject({
      method: 'GET',
      url: `${ch.gmailCallback}?code=good-code&state=eyJiIjoieCJ9.bad`,
    });
    expect(new URL(forged.headers.location as string).pathname).toBe('/app');
    const { url } = (await req(ctx.app, 'GET', ch.gmailStart(o.business.id), o.token)).json();
    const state = new URL(url).searchParams.get('state')!;
    const failed = await ctx.app.inject({
      method: 'GET',
      url: `${ch.gmailCallback}?code=bad-code&state=${encodeURIComponent(state)}`,
    });
    expect(new URL(failed.headers.location as string).searchParams.get('gmail')).toBe('error');
    expect(await ctx.prisma.channelConnection.count()).toBe(0);

    await connect('gm-first');
    const second = await ownerWithBusiness(ctx.app, 'gm-second');
    const s2 = (await req(ctx.app, 'GET', ch.gmailStart(second.business.id), second.token)).json();
    const taken = await ctx.app.inject({
      method: 'GET',
      url: `${ch.gmailCallback}?code=good-code&state=${encodeURIComponent(new URL(s2.url).searchParams.get('state')!)}`,
    });
    expect(new URL(taken.headers.location as string).searchParams.get('gmail')).toBe('taken');
  });

  it('only the owner connects', async () => {
    const o = await ownerWithBusiness(ctx.app, 'gm-perm');
    const stranger = await newUser(ctx.app, 'gm-stranger');
    expect(
      (await req(ctx.app, 'GET', ch.gmailStart(o.business.id), stranger.token)).statusCode,
    ).toBe(404);
  });

  it('new mail waits to be classified; bulk, auto and own mail are skipped; a second sync adds nothing', async () => {
    const { o } = await connect('gm-sync');
    const t = Date.now();
    gmail.inbox.push(
      mail({ receivedAt: t + 1000 }),
      mail({ receivedAt: t + 2000, from: 'news@shop.com', skip: true }),
      mail({ receivedAt: t + 3000, from: 'owner@gmail.com' }),
    );
    expect(await sync()).toBe(1);
    expect(await sync()).toBe(0);

    const inbox = (await req(ctx.app, 'GET', wp.inbox(o.business.id), o.token)).json();
    expect(inbox.numbers).toHaveLength(1);
    expect(inbox.numbers[0]).toMatchObject({
      channel: 'email',
      profileName: 'דנה כהן',
      messages: [{ body: 'היי, אפשר תור ליום חמישי?', subject: 'תור ליום חמישי' }],
    });
    expect(await ctx.prisma.lead.count()).toBe(0);
    expect(
      await ctx.prisma.notification.count({ where: { type: 'whatsapp.new_number' } }),
    ).toBeGreaterThan(0);
  });

  it('marking the sender business makes a lead; later mail joins it; replies go out through Gmail', async () => {
    const { o } = await connect('gm-lead');
    gmail.inbox.push(mail({ receivedAt: Date.now() + 1000 }));
    await sync();
    const number = await ctx.prisma.whatsAppNumber.findFirstOrThrow();
    const res = await req(ctx.app, 'POST', wp.classify(o.business.id, number.id), o.token, {
      as: 'BUSINESS',
    });
    expect(res.statusCode).toBe(200);
    const lead = await ctx.prisma.lead.findFirstOrThrow();
    expect(lead.source).toBe('email');

    // A later mail from the same person joins the same lead, without waiting again.
    gmail.inbox.push(mail({ receivedAt: Date.now() + 5000, text: 'ועוד שאלה' }));
    await sync();
    expect(await ctx.prisma.lead.count()).toBe(1);
    expect(await ctx.prisma.whatsAppMessage.count({ where: { leadId: lead.id } })).toBe(2);

    // The reply leaves through the connected Gmail, quoting the last mail.
    const reply = await req(ctx.app, 'POST', wp.thread(o.business.id, lead.id), o.token, {
      text: 'בטח, ביום חמישי ב־10:00',
    });
    expect(reply.statusCode).toBe(201);
    expect(gmail.sent).toHaveLength(1);
    expect(gmail.sent[0]).toMatchObject({
      from: 'owner@gmail.com',
      to: 'dana@example.com',
      subject: 'Re: תור ליום חמישי',
      text: 'בטח, ביום חמישי ב־10:00',
    });
    expect(gmail.sent[0]!.inReplyTo).toMatch(/^msg-\d+@example\.com$/);
    expect(email.to('dana@example.com')).toHaveLength(0);
  });

  it('a sender marked personal is ignored from then on', async () => {
    const { o } = await connect('gm-personal');
    gmail.inbox.push(mail({ receivedAt: Date.now() + 1000 }));
    await sync();
    const number = await ctx.prisma.whatsAppNumber.findFirstOrThrow();
    await req(ctx.app, 'POST', wp.classify(o.business.id, number.id), o.token, { as: 'PERSONAL' });
    gmail.inbox.push(mail({ receivedAt: Date.now() + 9000, text: 'עוד אחת' }));
    await sync();
    expect(await ctx.prisma.whatsAppMessage.count()).toBe(0);
    expect(await ctx.prisma.lead.count()).toBe(0);
  });

  it('a revoked grant is skipped without breaking the run; disconnecting revokes at Google', async () => {
    const { o } = await connect('gm-revoked');
    gmail.inbox.push(mail({ receivedAt: Date.now() + 1000 }));
    gmail.rejectToken = true;
    expect(await sync()).toBe(0);
    gmail.rejectToken = false;
    expect(await sync()).toBe(1);

    const off = await req(ctx.app, 'DELETE', ch.channel(o.business.id, 'gmail'), o.token);
    expect(off.json().gmail.connected).toBe(false);
    expect(gmail.revoked).toEqual(['refresh-token']);
    expect(await ctx.prisma.channelConnection.count()).toBe(0);
  });
});

describe('Gmail message parsing', () => {
  const b64 = (s: string) => Buffer.from(s).toString('base64url');
  const raw = (headers: Record<string, string>, over: object = {}) => ({
    id: 'x1',
    threadId: 't1',
    internalDate: '1700000000000',
    payload: {
      mimeType: 'multipart/alternative',
      headers: Object.entries(headers).map(([name, value]) => ({ name, value })),
      parts: [
        { mimeType: 'text/plain', body: { data: b64('שלום עולם') } },
        { mimeType: 'text/html', body: { data: b64('<p>שלום</p>') } },
      ],
    },
    ...over,
  });

  it('reads the sender, subject, text and message id', () => {
    const m = toMessage(
      raw({ From: '"Dana Cohen" <Dana@Example.com>', Subject: 'היי', 'Message-ID': '<a@b>' }),
    );
    expect(m).toMatchObject({
      from: 'dana@example.com',
      fromName: 'Dana Cohen',
      subject: 'היי',
      text: 'שלום עולם',
      messageId: 'a@b',
      receivedAt: 1700000000000,
      skip: false,
    });
  });

  it('skips lists, bulk, auto-replies, no-reply senders and Gmail’s promotional tabs', () => {
    expect(toMessage(raw({ From: 'a@b.com', 'List-Unsubscribe': '<x>' })).skip).toBe(true);
    expect(toMessage(raw({ From: 'a@b.com', Precedence: 'bulk' })).skip).toBe(true);
    expect(toMessage(raw({ From: 'a@b.com', 'Auto-Submitted': 'auto-replied' })).skip).toBe(true);
    expect(toMessage(raw({ From: 'No-Reply <noreply@b.com>' })).skip).toBe(true);
    expect(toMessage(raw({ From: 'a@b.com' }, { labelIds: ['CATEGORY_PROMOTIONS'] })).skip).toBe(
      true,
    );
    expect(toMessage(raw({ From: 'a@b.com', 'Auto-Submitted': 'no' })).skip).toBe(false);
  });
});
