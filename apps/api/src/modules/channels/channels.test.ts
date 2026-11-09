import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { apiPaths } from '@leadflow/shared';
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
    expect(pages).toEqual({ pages: [{ id: '100200300', name: 'דף לבדיקה' }] });

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
});
