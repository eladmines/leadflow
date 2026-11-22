import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { apiPaths } from '@simplecatch/shared';
import { createTestApp, resetDb, testConfig } from '../../../test/helpers';
import { addMember, newUser, ownerWithBusiness, req } from '../../../test/business-helpers';
import { MemoryMetaApi } from '../../integrations/meta';
import { MemoryMessengerSender } from '../../integrations/messenger';
import { MemoryWhatsAppSender, signWebhookBody } from '../../integrations/whatsapp';
import { MemoryEmailSender } from '../../integrations/email';
import { buildApp } from '../../app';

const SECRET = 'test-app-secret-0123456789';
const ch = apiPaths.channels;

describe('channels each business connects itself (F25)', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  const meta = new MemoryMetaApi();
  const whatsapp = new MemoryWhatsAppSender();
  const messenger = new MemoryMessengerSender();

  beforeAll(async () => {
    // No business in the environment: every connection comes from the Channels screen.
    const config = testConfig({
      WHATSAPP_APP_SECRET: SECRET,
      WHATSAPP_VERIFY_TOKEN: 'verify-me-please',
      META_APP_ID: '1056519927431185',
    });
    const base = await createTestApp({ config });
    await base.app.close();
    const app = await buildApp({
      config,
      prisma: base.prisma,
      emailSender: new MemoryEmailSender(),
      whatsappSender: whatsapp,
      messengerSender: messenger,
      metaApi: meta,
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
    meta.subscribed.clear();
    meta.instagram.clear();
  });

  const signed = (url: string, payload: object) => {
    const raw = JSON.stringify(payload);
    return ctx.app.inject({
      method: 'POST',
      url,
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': signWebhookBody(raw, SECRET),
      },
      payload: raw,
    });
  };
  let seq = 0;
  const whatsappTo = (phoneNumberId: string) => {
    seq += 1;
    return signed(apiPaths.whatsapp.webhook, {
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: phoneNumberId },
                contacts: [{ wa_id: '972501112233', profile: { name: 'נועה' } }],
                messages: [
                  {
                    from: '972501112233',
                    id: `wamid.ch-${seq}-${Date.now()}`,
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    type: 'text',
                    text: { body: 'היי' },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
  };
  const facebookTo = (pageId: string) => {
    seq += 1;
    return signed(apiPaths.whatsapp.messengerWebhook, {
      object: 'page',
      entry: [
        {
          id: pageId,
          messaging: [
            {
              sender: { id: '7766554433' },
              recipient: { id: pageId },
              timestamp: Date.now(),
              message: { mid: `m_ch-${seq}-${Date.now()}`, text: 'היי' },
            },
          ],
        },
      ],
    });
  };

  const instagramTo = (igId: string, extra: object = {}, echo = false) => {
    seq += 1;
    return signed(apiPaths.whatsapp.messengerWebhook, {
      object: 'instagram',
      entry: [
        {
          id: igId,
          messaging: [
            {
              sender: { id: echo ? igId : '1784140000' },
              recipient: { id: echo ? '1784140000' : igId },
              timestamp: Date.now(),
              message: {
                mid: `ig_ch-${seq}-${Date.now()}`,
                text: 'היי מאינסטגרם',
                ...(echo ? { is_echo: true } : {}),
                ...extra,
              },
            },
          ],
        },
      ],
    });
  };

  it('connects WhatsApp: checked with Meta, the token sealed, messages routed to the business', async () => {
    const o = await ownerWithBusiness(ctx.app, 'ch-owner');
    const before = (await req(ctx.app, 'GET', ch.list(o.business.id), o.token)).json();
    expect(before).toMatchObject({
      whatsapp: { connected: false },
      messenger: { connected: false },
      facebookLogin: true,
    });

    const res = await req(ctx.app, 'POST', ch.whatsapp(o.business.id), o.token, {
      phoneNumberId: '555000111',
      accessToken: 'EAA-whatsapp-token-0123456789',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().whatsapp).toEqual({
      channel: 'whatsapp',
      connected: true,
      name: '+1 555-000-1111',
      source: 'business',
    });
    // The token is never stored or returned in the clear.
    const row = await ctx.prisma.channelConnection.findFirstOrThrow();
    expect(row.tokenEncrypted).not.toContain('EAA-whatsapp-token');
    expect(res.body).not.toContain('EAA-whatsapp-token');

    // A message to that number lands in this business; one to an unknown number nowhere.
    await whatsappTo('555000111');
    await whatsappTo('999999999');
    const numbers = await ctx.prisma.whatsAppNumber.findMany();
    expect(numbers.map((n) => n.businessId)).toEqual([o.business.id]);
  });

  it('a number or Page belongs to one business; only the owner connects', async () => {
    const a = await ownerWithBusiness(ctx.app, 'ch-a');
    const b = await ownerWithBusiness(ctx.app, 'ch-b');
    const body = { phoneNumberId: '555000111', accessToken: 'EAA-whatsapp-token-0123456789' };
    await req(ctx.app, 'POST', ch.whatsapp(a.business.id), a.token, body);
    const taken = await req(ctx.app, 'POST', ch.whatsapp(b.business.id), b.token, body);
    expect(taken.statusCode).toBe(409);
    expect(taken.json().error.message).toBe('המספר או הדף כבר מחוברים לעסק אחר.');

    const manager = await newUser(ctx.app, 'ch-mgr');
    await addMember(ctx.prisma, a.business.id, manager.userId, 'MANAGER');
    expect((await req(ctx.app, 'GET', ch.list(a.business.id), manager.token)).statusCode).toBe(200);
    expect(
      (await req(ctx.app, 'POST', ch.whatsapp(a.business.id), manager.token, body)).statusCode,
    ).toBe(403);
    expect(
      (await req(ctx.app, 'DELETE', ch.channel(a.business.id, 'whatsapp'), manager.token))
        .statusCode,
    ).toBe(403);
  });

  it('connects a Facebook Page through sign-in, then routes its messages; disconnect stops them', async () => {
    const o = await ownerWithBusiness(ctx.app, 'ch-fb');
    const start = (await req(ctx.app, 'GET', ch.facebookStart(o.business.id), o.token)).json();
    const url = new URL(start.url);
    expect(url.hostname).toBe('www.facebook.com');
    expect(url.searchParams.get('client_id')).toBe('1056519927431185');
    const state = url.searchParams.get('state')!;

    // Facebook sends the person back with a code: the Pages wait for them to choose.
    const back = await ctx.app.inject({
      method: 'GET',
      url: `${ch.facebookCallback}?code=good-code&state=${encodeURIComponent(state)}`,
    });
    expect(back.statusCode).toBe(302);
    const location = new URL(back.headers.location as string);
    expect(location.pathname).toBe(`/b/${o.business.id}/settings`);
    const pendingId = location.searchParams.get('facebook')!;
    const pages = (
      await req(ctx.app, 'GET', ch.facebookPages(o.business.id, pendingId), o.token)
    ).json();
    expect(pages).toEqual({ pages: [{ id: '100200300', name: 'דף לבדיקה', instagram: null }] });

    const connected = await req(ctx.app, 'POST', ch.facebook(o.business.id), o.token, {
      pendingId,
      pageId: '100200300',
    });
    expect(connected.json().messenger).toMatchObject({ connected: true, name: 'דף לבדיקה' });
    expect(meta.subscribed.has('100200300')).toBe(true);
    // The sign-in can't be reused.
    expect(
      (await req(ctx.app, 'GET', ch.facebookPages(o.business.id, pendingId), o.token)).statusCode,
    ).toBe(409);

    await facebookTo('100200300');
    expect(await ctx.prisma.whatsAppNumber.count({ where: { businessId: o.business.id } })).toBe(1);

    const off = await req(ctx.app, 'DELETE', ch.channel(o.business.id, 'messenger'), o.token);
    expect(off.json().messenger.connected).toBe(false);
    expect(meta.subscribed.has('100200300')).toBe(false);
    await facebookTo('100200300');
    expect(await ctx.prisma.whatsAppMessage.count()).toBe(1);
  });

  it('a forged or failed sign-in goes nowhere', async () => {
    const o = await ownerWithBusiness(ctx.app, 'ch-forged');
    const forged = await ctx.app.inject({
      method: 'GET',
      url: `${ch.facebookCallback}?code=good-code&state=eyJiIjoieCJ9.bad`,
    });
    expect(new URL(forged.headers.location as string).pathname).toBe('/app');

    const { url } = (await req(ctx.app, 'GET', ch.facebookStart(o.business.id), o.token)).json();
    const state = new URL(url).searchParams.get('state')!;
    const failed = await ctx.app.inject({
      method: 'GET',
      url: `${ch.facebookCallback}?code=bad-code&state=${encodeURIComponent(state)}`,
    });
    expect(new URL(failed.headers.location as string).searchParams.get('facebook')).toBe('error');
    expect(await ctx.prisma.oAuthPending.count()).toBe(0);
  });

  it('connects Instagram from the connected Page, routes its messages, and replies', async () => {
    const o = await ownerWithBusiness(ctx.app, 'ch-ig');
    meta.instagram.set('100200300', { id: '17841400001', username: 'shiran_hair' });
    // Without the Facebook Page there is nothing to take Instagram from.
    const early = await req(ctx.app, 'POST', ch.instagram(o.business.id), o.token, {});
    expect(early.statusCode).toBe(409);

    const { url } = (await req(ctx.app, 'GET', ch.facebookStart(o.business.id), o.token)).json();
    const state = new URL(url).searchParams.get('state')!;
    const back = await ctx.app.inject({
      method: 'GET',
      url: `${ch.facebookCallback}?code=good-code&state=${encodeURIComponent(state)}`,
    });
    const pendingId = new URL(back.headers.location as string).searchParams.get('facebook')!;
    await req(ctx.app, 'POST', ch.facebook(o.business.id), o.token, {
      pendingId,
      pageId: '100200300',
    });

    const res = await req(ctx.app, 'POST', ch.instagram(o.business.id), o.token, {});
    expect(res.json().instagram).toEqual({
      channel: 'instagram',
      connected: true,
      name: '@shiran_hair',
      source: 'business',
    });
    expect(res.body).not.toContain('page-token');

    // A DM to that account becomes an Instagram lead; one to another account lands nowhere.
    messenger.names.set('1784140000', 'dana_cohen');
    await instagramTo('17841400001');
    await instagramTo('99999');
    const number = await ctx.prisma.whatsAppNumber.findFirstOrThrow({
      where: { channel: 'instagram' },
    });
    expect(number).toMatchObject({ businessId: o.business.id, phone: 'ig:1784140000' });
    const lead = await ctx.prisma.lead.findFirstOrThrow({ where: { source: 'instagram' } });
    const contact = await ctx.prisma.contact.findUniqueOrThrow({ where: { id: lead.contactId } });
    expect(contact.name).toBe('dana_cohen');

    // Reply from the thread: sent through Instagram with the sender's id.
    const reply = await req(
      ctx.app,
      'POST',
      apiPaths.whatsapp.thread(o.business.id, lead.id),
      o.token,
      { text: 'שלום דנה!' },
    );
    expect(reply.statusCode).toBe(201);
    expect(reply.json().message.channel).toBe('instagram');
    expect(messenger.sent.at(-1)).toMatchObject({ to: '1784140000', text: 'שלום דנה!' });

    // What the account writes from Instagram itself shows once, even when Meta repeats it.
    const echo = await instagramTo('17841400001', { mid: 'ig_echo-1', text: 'מהאפליקציה' }, true);
    expect(echo.statusCode).toBe(200);
    await instagramTo('17841400001', { mid: 'ig_echo-1', text: 'מהאפליקציה' }, true);
    expect(
      await ctx.prisma.whatsAppMessage.count({ where: { body: 'מהאפליקציה', direction: 'OUT' } }),
    ).toBe(1);

    // Disconnecting Instagram keeps the Page's subscription while Facebook still uses it.
    const off = await req(ctx.app, 'DELETE', ch.channel(o.business.id, 'instagram'), o.token);
    expect(off.json().instagram.connected).toBe(false);
    expect(meta.subscribed.has('100200300')).toBe(true);
    // After disconnecting, its messages go nowhere.
    const stored = await ctx.prisma.whatsAppMessage.count();
    await instagramTo('17841400001');
    expect(await ctx.prisma.whatsAppMessage.count()).toBe(stored);
  });

  it('connects Instagram through sign-in, for a Page with an account; one without gets a clear error', async () => {
    const o = await ownerWithBusiness(ctx.app, 'ch-ig2');
    meta.pagesToReturn = [
      { id: '100200300', name: 'דף לבדיקה', accessToken: 'page-token' },
      {
        id: '100200301',
        name: 'דף עם אינסטגרם',
        accessToken: 'page-token-2',
        instagram: { id: '17841400002', username: 'with_ig' },
      },
    ];
    const start = (
      await req(ctx.app, 'GET', `${ch.facebookStart(o.business.id)}?for=instagram`, o.token)
    ).json();
    const scope = new URL(start.url).searchParams.get('scope');
    expect(scope).toContain('instagram_manage_messages');
    const state = new URL(start.url).searchParams.get('state')!;
    const back = await ctx.app.inject({
      method: 'GET',
      url: `${ch.facebookCallback}?code=good-code&state=${encodeURIComponent(state)}`,
    });
    const location = new URL(back.headers.location as string);
    const pendingId = location.searchParams.get('instagram')!;
    expect(pendingId).toBeTruthy();
    const pages = (
      await req(ctx.app, 'GET', ch.facebookPages(o.business.id, pendingId), o.token)
    ).json();
    expect(pages.pages.map((p: { instagram: string | null }) => p.instagram)).toEqual([
      null,
      '@with_ig',
    ]);

    const none = await req(ctx.app, 'POST', ch.instagram(o.business.id), o.token, {
      pendingId,
      pageId: '100200300',
    });
    expect(none.statusCode).toBe(409);
    expect(none.json().error.message).toMatch(/אינסטגרם עסקי/);

    const ok = await req(ctx.app, 'POST', ch.instagram(o.business.id), o.token, {
      pendingId,
      pageId: '100200301',
    });
    expect(ok.json().instagram).toMatchObject({ connected: true, name: '@with_ig' });
    expect(meta.subscribed.has('100200301')).toBe(true);
    // Instagram alone: disconnecting it also stops the Page's messages.
    await req(ctx.app, 'DELETE', ch.channel(o.business.id, 'instagram'), o.token);
    expect(meta.subscribed.has('100200301')).toBe(false);
    meta.pagesToReturn = [{ id: '100200300', name: 'דף לבדיקה', accessToken: 'page-token' }];
  });
});
