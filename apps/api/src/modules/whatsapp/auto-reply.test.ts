import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { apiPaths, AUTO_REPLY_DEFAULT, AUTO_REPLY_DEFAULT_EN } from '@leadflow/shared';
import {
  createTestApp,
  csrfHeaders,
  resetDb,
  sessionCookie,
  testConfig,
} from '../../../test/helpers';
import { addMember, newUser, req } from '../../../test/business-helpers';
import { MemoryWhatsAppSender, signWebhookBody } from '../../integrations/whatsapp';
import { MemoryEmailSender } from '../../integrations/email';
import { buildApp } from '../../app';

const BUSINESS_ID = '11111111-2222-4333-8444-555555555555';
const SECRET = 'test-app-secret-0123456789';
const PHONE_ID = '1234567890';
const FROM = '972501112233';
const wp = apiPaths.whatsapp;

let seq = 0;
const text = (body: string, from = FROM) => {
  seq += 1;
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        changes: [
          {
            field: 'messages',
            value: {
              metadata: { phone_number_id: PHONE_ID },
              contacts: [{ wa_id: from, profile: { name: 'נועה' } }],
              messages: [
                {
                  from,
                  id: `wamid.ar-${seq}-${Date.now()}`,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: 'text',
                  text: { body },
                },
              ],
            },
          },
        ],
      },
    ],
  };
};
/** A tiny MP4 header ("ftyp" at byte 4) followed by filler. */
const mp4 = (size = 2048) => {
  const b = Buffer.alloc(size);
  b.writeUInt32BE(24, 0);
  b.write('ftypisom', 4, 'latin1');
  return b;
};

describe('WhatsApp automatic replies and statuses (D-123)', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  const whatsapp = new MemoryWhatsAppSender();

  beforeAll(async () => {
    const config = testConfig({
      WHATSAPP_BUSINESS_ID: BUSINESS_ID,
      WHATSAPP_APP_SECRET: SECRET,
      WHATSAPP_VERIFY_TOKEN: 'verify-me-please',
      WHATSAPP_PHONE_NUMBER_ID: PHONE_ID,
    });
    const base = await createTestApp({ config });
    await base.app.close();
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

  async function setup() {
    const owner = await newUser(ctx.app, 'ar-owner');
    // A new business: no mode chosen, so the default (automatic reply) applies.
    await ctx.prisma.business.create({
      data: { id: BUSINESS_ID, name: 'די ג׳יי רון', industry: 'events', status: 'ACTIVE' },
    });
    await addMember(ctx.prisma, BUSINESS_ID, owner.userId, 'OWNER');
    return owner;
  }
  const post = async (payload: object) => {
    const raw = JSON.stringify(payload);
    const res = await ctx.app.inject({
      method: 'POST',
      url: wp.webhook,
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': signWebhookBody(raw, SECRET),
      },
      payload: raw,
    });
    expect(res.statusCode).toBe(200);
  };
  const settings = async (token: string) =>
    (await req(ctx.app, 'GET', wp.bot(BUSINESS_ID), token)).json().settings;
  const save = (token: string, patch: Record<string, unknown>) =>
    settings(token).then((s) =>
      req(ctx.app, 'PUT', wp.bot(BUSINESS_ID), token, {
        mode: s.mode,
        autoReplyText: s.autoReplyText,
        enabled: s.enabled,
        autoConfirm: s.autoConfirm,
        holdDate: s.holdDate,
        texts: s.texts,
        showcase: { ...s.showcase, text: s.showcase.text ?? null },
        ...patch,
      }),
    );
  const uploadVideo = (token: string, statusId: string, body: Buffer, type = 'video/mp4') => {
    const boundary = '----lf-video';
    const payload = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="v.mp4"\r\nContent-Type: ${type}\r\n\r\n`,
      ),
      body,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    return ctx.app.inject({
      method: 'PUT',
      url: wp.statusVideo(BUSINESS_ID, statusId),
      headers: {
        ...csrfHeaders,
        ...sessionCookie(token),
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload,
    });
  };

  it('answers with the general reply by default, once per 12 hours, and still tells the team', async () => {
    const owner = await setup();
    const s = await settings(owner.token);
    expect(s.mode).toBe('auto_reply');
    expect(s.statuses.map((x: { id: string }) => x.id)).toEqual([
      'event',
      'meeting',
      'vacation',
      'closed',
    ]);
    expect(s.activeStatus).toBeNull();

    await post(text('היי, אתה פנוי ב-14.2?'));
    expect(whatsapp.sent).toHaveLength(1);
    expect(whatsapp.sent[0]!.text).toBe(AUTO_REPLY_DEFAULT.replace('{business}', 'די ג׳יי רון'));
    // The reply is in the conversation, and the message reached the owner's bell.
    expect(await ctx.prisma.whatsAppMessage.count({ where: { direction: 'OUT' } })).toBe(1);
    expect(await ctx.prisma.notification.count()).toBeGreaterThan(0);

    await post(text('עוד שאלה'));
    expect(whatsapp.sent).toHaveLength(1);

    // 13 hours later, a new reply.
    await ctx.prisma.whatsAppNumber.updateMany({
      data: { autoReplyAt: new Date(Date.now() - 13 * 3600_000) },
    });
    await post(text('שוב היי'));
    expect(whatsapp.sent).toHaveLength(2);
  });

  it('an English business replies in English, with English statuses (D-143)', async () => {
    const owner = await setup();
    await ctx.prisma.business.update({ where: { id: BUSINESS_ID }, data: { language: 'en' } });
    const s = await settings(owner.token);
    expect(s.autoReplyDefault).toBe(AUTO_REPLY_DEFAULT_EN);
    expect(s.statuses.map((x: { label: string }) => x.label)).toEqual([
      'At an event',
      'In a meeting',
      'On vacation',
      'Closed now',
    ]);
    expect(s.defaults.greeting).toMatch(/^Hi! This is \{business\}/);
    await post(text('Hi, are you free on 14/2?'));
    expect(whatsapp.sent[0]!.text).toBe(AUTO_REPLY_DEFAULT_EN.replace('{business}', 'די ג׳יי רון'));
  });

  it('sends the status message and its video while a status is on, until it ends', async () => {
    const owner = await setup();
    const up = await uploadVideo(owner.token, 'event', mp4(4096));
    expect(up.statusCode).toBe(200);
    expect(up.json().settings.statuses.find((x: { id: string }) => x.id === 'event').video).toEqual(
      { sizeBytes: 4096 },
    );
    expect(up.json().settings.videoBytesUsed).toBe(4096);
    const until = new Date(Date.now() + 3600_000).toISOString();
    const on = await req(ctx.app, 'PUT', wp.status(BUSINESS_ID), owner.token, {
      id: 'event',
      until,
    });
    expect(on.json().settings.activeStatus).toEqual({ id: 'event', until });

    await post(text('היי'));
    expect(whatsapp.sent).toHaveLength(2);
    expect(whatsapp.sent[0]!.text).toMatch(/^היי! כרגע אני באירוע 🎉/);
    expect(whatsapp.sent[1]!.videoBytes).toBe(4096);
    const stored = await ctx.prisma.whatsAppMessage.findMany({
      where: { direction: 'OUT' },
      orderBy: { createdAt: 'asc' },
    });
    expect(stored.map((m) => m.body)).toContain('[וידאו]');

    // The owner can watch it; nobody else can reach it publicly.
    const watch = await req(ctx.app, 'GET', wp.statusVideo(BUSINESS_ID, 'event'), owner.token);
    expect(watch.headers['content-type']).toBe('video/mp4');
    expect(watch.rawPayload.length).toBe(4096);

    // After the status ends, the general reply is back.
    await ctx.prisma.business.update({
      where: { id: BUSINESS_ID },
      data: {
        whatsappActiveStatus: { id: 'event', until: new Date(Date.now() - 1000).toISOString() },
      },
    });
    expect((await settings(owner.token)).activeStatus).toBeNull();
    whatsapp.clear();
    await post(text('היי', '972509998877'));
    expect(whatsapp.sent).toHaveLength(1);
    expect(whatsapp.sent[0]!.text).toContain('תודה שכתבת');
  });

  it('keeps quiet when off, when a team member is talking, and for paused or personal numbers', async () => {
    const owner = await setup();
    await save(owner.token, { mode: 'off', enabled: false });
    await post(text('היי'));
    expect(whatsapp.sent).toHaveLength(0);

    await save(owner.token, { mode: 'auto_reply', enabled: false });
    await ctx.prisma.whatsAppNumber.updateMany({ data: { status: 'PERSONAL' } });
    await post(text('היי שוב'));
    expect(whatsapp.sent).toHaveLength(0);

    const number = await ctx.prisma.whatsAppNumber.create({
      data: {
        businessId: BUSINESS_ID,
        phone: '+972507776655',
        status: 'BUSINESS',
        botPaused: true,
      },
    });
    await post(text('היי', '972507776655'));
    expect(whatsapp.sent).toHaveLength(0);

    await ctx.prisma.whatsAppNumber.update({
      where: { id: number.id },
      data: { botPaused: false },
    });
    await ctx.prisma.whatsAppMessage.create({
      data: {
        businessId: BUSINESS_ID,
        numberId: number.id,
        direction: 'OUT',
        waMessageId: 'wamid.team-1',
        body: 'אני כאן',
        status: 'sent',
        senderId: owner.userId,
      },
    });
    await post(text('תודה', '972507776655'));
    expect(whatsapp.sent).toHaveLength(0);
  });

  it('saves its own wording and statuses; a deleted status takes its video and stops being on', async () => {
    const owner = await setup();
    await uploadVideo(owner.token, 'vacation', mp4());
    await req(ctx.app, 'PUT', wp.status(BUSINESS_ID), owner.token, { id: 'vacation', until: null });
    const saved = await save(owner.token, {
      autoReplyText: 'שלום מ{business}! נחזור בקרוב',
      statuses: [
        { id: 'event', label: 'באירוע', text: 'אני באירוע, אחזור אחרי 23:00' },
        { id: 'c-studio', label: 'באולפן', text: 'באולפן עד הערב 🎧' },
      ],
    });
    expect(saved.statusCode).toBe(200);
    const s = saved.json().settings;
    expect(s.autoReplyText).toBe('שלום מ{business}! נחזור בקרוב');
    expect(s.statuses).toEqual([
      {
        id: 'event',
        label: 'באירוע',
        text: 'אני באירוע, אחזור אחרי 23:00',
        preset: true,
        video: null,
      },
      { id: 'c-studio', label: 'באולפן', text: 'באולפן עד הערב 🎧', preset: false, video: null },
    ]);
    expect(s.activeStatus).toBeNull();
    expect(s.videoBytesUsed).toBe(0);
    // The deleted status's video is gone too.
    expect(
      (await req(ctx.app, 'GET', wp.statusVideo(BUSINESS_ID, 'vacation'), owner.token)).statusCode,
    ).toBe(404);

    await post(text('היי'));
    expect(whatsapp.sent[0]!.text).toBe('שלום מדי ג׳יי רון! נחזור בקרוב');
  });

  it('checks statuses and videos', async () => {
    const owner = await setup();
    expect(
      (await req(ctx.app, 'PUT', wp.status(BUSINESS_ID), owner.token, { id: 'nope', until: null }))
        .statusCode,
    ).toBe(404);
    const past = await req(ctx.app, 'PUT', wp.status(BUSINESS_ID), owner.token, {
      id: 'event',
      until: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(past.statusCode).toBe(400);
    expect(past.json().error.message).toBe('הזמן שבחרתם כבר עבר');

    const notMp4 = await uploadVideo(owner.token, 'event', Buffer.from('not a video at all'));
    expect(notMp4.statusCode).toBe(400);
    expect(notMp4.json().error.message).toBe('אפשר להעלות רק סרטון MP4');
    const tooBig = await uploadVideo(owner.token, 'event', mp4(16 * 1024 * 1024 + 10));
    expect(tooBig.statusCode).toBe(400);
    expect((await uploadVideo(owner.token, 'nope', mp4())).statusCode).toBe(404);

    // Removing a video.
    await uploadVideo(owner.token, 'event', mp4());
    const removed = await req(ctx.app, 'DELETE', wp.statusVideo(BUSINESS_ID, 'event'), owner.token);
    expect(removed.json().settings.statuses[0].video).toBeNull();
    expect(
      (await req(ctx.app, 'GET', wp.statusVideo(BUSINESS_ID, 'event'), owner.token)).statusCode,
    ).toBe(404);

    // Only people with the WhatsApp inbox permission manage it.
    const employee = await newUser(ctx.app, 'ar-emp');
    await addMember(ctx.prisma, BUSINESS_ID, employee.userId, 'EMPLOYEE');
    const denied = await req(ctx.app, 'PUT', wp.status(BUSINESS_ID), employee.token, {
      id: 'event',
      until: null,
    });
    expect(denied.statusCode).toBe(403);
  });
});
