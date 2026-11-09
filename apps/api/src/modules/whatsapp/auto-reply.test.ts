import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
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
  const uploadVideo = (
    token: string,
    body: Buffer,
    type = 'video/mp4',
    url = wp.showcaseVideo(BUSINESS_ID),
  ) => {
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
      url,
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

  it('"A peek at the business" no longer follows the automatic reply (D-164)', async () => {
    await setup();
    await ctx.prisma.business.update({
      where: { id: BUSINESS_ID },
      data: {
        whatsappBotShowcase: {
          enabled: true,
          text: 'בינתיים, תציצו 👇',
          link: 'https://example.com/work',
          assetIds: [],
        },
      },
    });
    await post(text('היי'));
    expect(whatsapp.sent.map((m) => m.text)).toEqual([
      AUTO_REPLY_DEFAULT.replace('{business}', 'די ג׳יי רון'),
    ]);
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

  it('sends the status message while a status is on, until it ends', async () => {
    const owner = await setup();
    const until = new Date(Date.now() + 3600_000).toISOString();
    const on = await req(ctx.app, 'PUT', wp.status(BUSINESS_ID), owner.token, {
      id: 'event',
      until,
    });
    expect(on.json().settings.activeStatus).toEqual({ id: 'event', until });

    await post(text('היי'));
    expect(whatsapp.sent).toHaveLength(1);
    expect(whatsapp.sent[0]!.text).toMatch(/^היי! כרגע אני באירוע 🎉/);

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

  it('saves its own wording and statuses; a deleted status stops being on', async () => {
    const owner = await setup();
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
        assetIds: [],
        preset: true,
        video: null,
      },
      {
        id: 'c-studio',
        label: 'באולפן',
        text: 'באולפן עד הערב 🎧',
        assetIds: [],
        preset: false,
        video: null,
      },
    ]);
    expect(s.activeStatus).toBeNull();

    await post(text('היי'));
    expect(whatsapp.sent[0]!.text).toBe('שלום מדי ג׳יי רון! נחזור בקרוב');
  });

  it('checks statuses', async () => {
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

    // Only people with the WhatsApp inbox permission manage it.
    const employee = await newUser(ctx.app, 'ar-emp');
    await addMember(ctx.prisma, BUSINESS_ID, employee.userId, 'EMPLOYEE');
    const denied = await req(ctx.app, 'PUT', wp.status(BUSINESS_ID), employee.token, {
      id: 'event',
      until: null,
    });
    expect(denied.statusCode).toBe(403);
    expect((await uploadVideo(employee.token, mp4())).statusCode).toBe(403);
  });

  it('"At event" sends its own photos and video after its message (D-164)', async () => {
    const owner = await setup();
    const statusVideo = wp.statusVideo(BUSINESS_ID, 'event');
    const notMp4 = await uploadVideo(
      owner.token,
      Buffer.from('not a video'),
      'video/mp4',
      statusVideo,
    );
    expect(notMp4.statusCode).toBe(400);
    expect(notMp4.json().error.message).toBe('אפשר להעלות רק סרטון MP4');
    expect(
      (await uploadVideo(owner.token, mp4(), 'video/mp4', wp.statusVideo(BUSINESS_ID, 'nope')))
        .statusCode,
    ).toBe(404);

    const up = await uploadVideo(owner.token, mp4(4096), 'video/mp4', statusVideo);
    expect(up.statusCode).toBe(200);
    const event = () => up.json().settings.statuses.find((x: { id: string }) => x.id === 'event');
    expect(event().video).toEqual({ sizeBytes: 4096 });

    // A photo from the library; saving the statuses keeps the video.
    const key = `${BUSINESS_ID}/${randomUUID()}.webp`;
    const webp = await sharp({
      create: { width: 40, height: 30, channels: 3, background: '#2c837d' },
    })
      .webp()
      .toBuffer();
    await ctx.app.storage.put(key, webp, 'image/webp');
    const asset = await ctx.prisma.asset.create({
      data: {
        businessId: BUSINESS_ID,
        key,
        mime: 'image/webp',
        sizeBytes: webp.length,
        width: 40,
        height: 30,
      },
    });
    const s = await settings(owner.token);
    const saved = await save(owner.token, {
      statuses: s.statuses.map((x: { id: string; label: string; text: string }) => ({
        id: x.id,
        label: x.label,
        text: x.text,
        assetIds: x.id === 'event' ? [asset.id] : [],
      })),
    });
    expect(saved.statusCode).toBe(200);
    expect(
      saved.json().settings.statuses.find((x: { id: string }) => x.id === 'event'),
    ).toMatchObject({ assetIds: [asset.id], video: { sizeBytes: 4096 } });
    // Another business's photo can't go into a status.
    const foreign = await save(owner.token, {
      statuses: [
        {
          id: 'event',
          label: 'באירוע',
          text: 'היי',
          assetIds: ['00000000-0000-4000-8000-000000000000'],
        },
      ],
    });
    expect(foreign.statusCode).toBe(400);

    await req(ctx.app, 'PUT', wp.status(BUSINESS_ID), owner.token, { id: 'event', until: null });
    await post(text('היי'));
    // The status message, its photo, then its video.
    expect(whatsapp.sent).toHaveLength(3);
    expect(whatsapp.sent[1]!.imageBytes).toBeGreaterThan(0);
    expect(whatsapp.sent[2]!.videoBytes).toBe(4096);
    const stored = await ctx.prisma.whatsAppMessage.findMany({ where: { direction: 'OUT' } });
    expect(stored.map((m) => m.body)).toEqual(expect.arrayContaining(['[תמונה]', '[וידאו]']));

    // The owner can watch it; then remove it.
    const watch = await req(ctx.app, 'GET', statusVideo, owner.token);
    expect(watch.headers['content-type']).toBe('video/mp4');
    const removed = await req(ctx.app, 'DELETE', statusVideo, owner.token);
    expect(
      removed.json().settings.statuses.find((x: { id: string }) => x.id === 'event').video,
    ).toBeNull();
    expect((await req(ctx.app, 'GET', statusVideo, owner.token)).statusCode).toBe(404);
  });

  it('"A peek" keeps its own video for the booking bot (D-151)', async () => {
    const owner = await setup();
    const up = await uploadVideo(owner.token, mp4(4096));
    expect(up.json().settings.showcase.video).toEqual({ sizeBytes: 4096 });
    const removed = await req(ctx.app, 'DELETE', wp.showcaseVideo(BUSINESS_ID), owner.token);
    expect(removed.json().settings.showcase.video).toBeNull();
  });
  const tapRow = (id: string) => {
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
                contacts: [{ wa_id: FROM, profile: { name: 'נועה' } }],
                messages: [
                  {
                    from: FROM,
                    id: `wamid.ar-tap-${seq}-${Date.now()}`,
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    type: 'interactive',
                    interactive: { type: 'list_reply', list_reply: { id, title: id } },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
  };

  it('asks when to talk; a chosen time becomes a call-back task, then "A peek" (D-165)', async () => {
    const owner = await setup();
    await ctx.prisma.business.update({
      where: { id: BUSINESS_ID },
      data: {
        timezone: 'Asia/Jerusalem',
        whatsappBotShowcase: {
          enabled: true,
          text: 'בינתיים, תציצו 👇',
          link: 'https://example.com/work',
          assetIds: [],
        },
      },
    });
    await post(text('היי'));
    expect(whatsapp.sent).toHaveLength(1);
    const ids = whatsapp.sent[0]!.choices!.map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(['cb:mor', 'cb:aft', 'cb:other']));
    // The automatic reply doesn't offer booking.
    expect(ids).not.toContain('book');

    await post(tapRow('cb:mor'));
    expect(whatsapp.sent.map((m) => m.text).slice(1)).toEqual([
      'מעולה! נחזור אליכם מחר בבוקר 🙏',
      'בינתיים, תציצו 👇\nhttps://example.com/work',
    ]);
    // The sender is now a customer with a lead, and the owner has a task for tomorrow 09:00.
    const lead = await ctx.prisma.lead.findFirstOrThrow({ include: { contact: true } });
    const [task] = await ctx.prisma.task.findMany();
    expect(task).toMatchObject({
      title: 'לחזור לנועה — מחר בבוקר',
      assigneeId: owner.userId,
      leadId: lead.id,
    });
    const local = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Jerusalem',
      hour: '2-digit',
      minute: '2-digit',
    }).format(task!.dueAt);
    expect(local).toBe('09:00');
    expect(task!.dueAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('"Another time": the customer writes it, and it goes into the task (D-165)', async () => {
    await setup();
    await post(text('היי'));
    await post(tapRow('cb:other'));
    expect(whatsapp.sent.at(-1)!.text).toBe('מתי נוח לכם? כתבו יום ושעה 🙂');
    await post(text('ביום חמישי אחרי 16:00'));
    expect(whatsapp.sent.at(-1)!.text).toBe('תודה! נחזור אליכם בזמן שכתבתם 🙏');
    const [task] = await ctx.prisma.task.findMany();
    expect(task!.title).toBe('לחזור לנועה — ביום חמישי אחרי 16:00');
  });
});
