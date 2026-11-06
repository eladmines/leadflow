import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { apiPaths, WEEKDAYS } from '@leadflow/shared';
import { createTestApp, resetDb, testConfig } from '../../../test/helpers';
import { addMember, newUser, req } from '../../../test/business-helpers';
import { MemoryWhatsAppSender, signWebhookBody } from '../../integrations/whatsapp';
import { MemoryEmailSender } from '../../integrations/email';
import { buildApp } from '../../app';
import { addDaysTo, freeTimes, todayIn } from '../appointments/availability';
import { parseEventDate } from './bot';
import { WhatsAppService } from './service';
import { zonedTimeToUtc } from '../../lib/time';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';

const BUSINESS_ID = '11111111-2222-4333-8444-555555555555';
const SECRET = 'test-app-secret-0123456789';
const PHONE_ID = '1234567890';
const TZ = 'Asia/Jerusalem';
const FROM = '972501112233';
const wp = apiPaths.whatsapp;

/** Open every day nearly all day, so there are free times whenever the tests run. */
const allDay = Object.fromEntries(
  WEEKDAYS.map((d) => [d, { open: true, from: '00:00', to: '23:30' }]),
);

let seq = 0;
function event(message: Record<string, unknown>, from = FROM) {
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
              contacts: [{ wa_id: from, profile: { name: 'נועה לוי' } }],
              messages: [
                {
                  from,
                  id: `wamid.bot-${seq}-${Date.now()}`,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  ...message,
                },
              ],
            },
          },
        ],
      },
    ],
  };
}
const text = (body: string, from?: string) => event({ type: 'text', text: { body } }, from);
const tap = (id: string, title = id) =>
  event({
    type: 'interactive',
    interactive:
      id.startsWith('ok') || id === 'cancel' || id === 'other_time'
        ? { type: 'button_reply', button_reply: { id, title } }
        : { type: 'list_reply', list_reply: { id, title } },
  });

describe('WhatsApp booking bot (D-102)', () => {
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

  async function setup({
    enabled = true,
    autoConfirm = true,
    services = 2,
    industry = 'beauty',
    name = 'עיצוב שיער סיגלית',
  } = {}) {
    const owner = await newUser(ctx.app, 'bot-owner');
    await ctx.prisma.business.create({
      data: {
        id: BUSINESS_ID,
        name,
        industry,
        status: 'ACTIVE',
        timezone: TZ,
        openingHours: allDay,
        whatsappBotEnabled: enabled,
        // These tests drive the booking bot (D-123: the default mode is the automatic reply).
        whatsappReplyMode: enabled ? 'booking' : 'off',
        whatsappBotAutoConfirm: autoConfirm,
      },
    });
    await addMember(ctx.prisma, BUSINESS_ID, owner.userId, 'OWNER');
    const created = [];
    for (const [i, name] of ['תספורת נשים', 'צבע'].slice(0, services).entries()) {
      created.push(
        await ctx.prisma.service.create({
          data: { businessId: BUSINESS_ID, name, durationMin: 30 + i * 30, price: 150 },
        }),
      );
    }
    return { owner, services: created };
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
  const last = () => whatsapp.sent.at(-1)!;

  it('stays silent while switched off', async () => {
    await setup({ enabled: false });
    await post(text('היי, אפשר לקבוע תור?'));
    expect(whatsapp.sent).toHaveLength(0);
  });

  it('books a new customer from service to confirmation, and files them as a customer', async () => {
    const { owner, services } = await setup();
    await post(text('היי, אפשר לקבוע תור?'));
    expect(last().text).toContain('עיצוב שיער סיגלית');
    expect(last().choices!.map((c) => c.title)).toEqual(['צבע', 'תספורת נשים', 'דברו עם הצוות']);

    const haircut = services[0]!;
    await post(tap(`svc:${haircut.id}`));
    expect(last().text).toBe('באיזה יום נוח לכם?');
    const day = last().choices![0]!;
    expect(day.id).toMatch(/^day:\d{4}-\d{2}-\d{2}$/);
    expect(day.description).toMatch(/זמנים פנויים|זמן פנוי אחד/);

    await post(tap(day.id));
    const times = last().choices!;
    expect(times.length).toBeLessThanOrEqual(10);
    expect(times.at(-1)).toEqual({ id: 'other_day', title: 'יום אחר' });
    const time = times[0]!;

    await post(tap(time.id));
    expect(last().text).toMatch(/^לקבוע לכם תספורת נשים ב.* בשעה \d{2}:\d{2}\?$/);
    expect(last().choices!.map((c) => c.id)).toEqual(['ok', 'other_time', 'cancel']);

    await post(tap('ok'));
    expect(last().text).toMatch(/^מעולה! קבענו לכם תספורת נשים ל/);

    const [appt] = await ctx.prisma.appointment.findMany();
    const date = day.id.slice(4);
    expect(appt).toMatchObject({
      status: 'CONFIRMED',
      source: 'whatsapp',
      staffId: owner.userId,
      serviceId: haircut.id,
      startsAt: zonedTimeToUtc(date, time.title, TZ),
    });
    expect(appt!.endsAt.getTime() - appt!.startsAt.getTime()).toBe(30 * 60_000);

    // The number is a customer now: a WhatsApp lead with the whole conversation on it.
    const number = await ctx.prisma.whatsAppNumber.findFirstOrThrow();
    expect(number.status).toBe('BUSINESS');
    const lead = await ctx.prisma.lead.findFirstOrThrow({ include: { contact: true } });
    expect(lead).toMatchObject({ source: 'whatsapp', id: appt!.leadId });
    expect(lead.contact).toMatchObject({ name: 'נועה לוי', phone: `+${FROM}` });
    const thread = (await req(ctx.app, 'GET', wp.thread(BUSINESS_ID, lead.id), owner.token)).json();
    expect(thread.messages.length).toBe(10);
    expect(thread.messages.at(-1)).toMatchObject({ direction: 'OUT', sender: null });
    expect(await ctx.prisma.whatsAppBotSession.count()).toBe(0);

    // One notification for the booking, not one per tap.
    const notes = await ctx.prisma.notification.findMany({ where: { userId: owner.userId } });
    expect(notes.map((n) => n.type).sort()).toEqual(['appointment.booked', 'whatsapp.new_number']);
  });

  it("greets a new number's first message, but not its next ones", async () => {
    await setup();
    await post(text('היי'));
    expect(last().text).toContain('רוצים לקבוע תור?');
    await post(tap('cancel'));
    const before = whatsapp.sent.length;
    await post(text('שאלה על מחירים'));
    expect(whatsapp.sent).toHaveLength(before);
  });

  it('a single service skips straight to the days; "pending approval" books as a request', async () => {
    await setup({ services: 1, autoConfirm: false });
    await post(text('תור בבקשה'));
    expect(last().text).toBe('באיזה יום נוח לכם?');
    await post(tap(last().choices![0]!.id));
    await post(tap(last().choices![0]!.id));
    await post(tap('ok'));
    expect(last().text).toMatch(/^קיבלנו את הבקשה/);
    expect((await ctx.prisma.appointment.findFirstOrThrow()).status).toBe('REQUESTED');
  });

  it('offers other times when the chosen one was taken in the meantime', async () => {
    const { owner } = await setup({ services: 1 });
    await post(text('אפשר תור?'));
    // Not today: late in the day it may have a single free time left.
    const date = last()
      .choices!.find((c) => c.id.startsWith('day:') && !c.title.startsWith('היום'))!
      .id.slice(4);
    await post(tap(`day:${date}`));
    const time = last().choices![0]!.title;
    await post(tap(`time:${time}`));
    const contact = await ctx.prisma.contact.create({
      data: { businessId: BUSINESS_ID, name: 'מישהי אחרת', phone: '+972509999999' },
    });
    const startsAt = zonedTimeToUtc(date, time, TZ);
    await ctx.prisma.appointment.create({
      data: {
        businessId: BUSINESS_ID,
        contactId: contact.id,
        staffId: owner.userId,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 30 * 60_000),
      },
    });
    await post(tap('ok'));
    expect(last().text).toMatch(/^אופס, השעה הזו נתפסה הרגע/);
    expect(last().choices!.map((c) => c.title)).not.toContain(time);
    expect(await ctx.prisma.appointment.count()).toBe(1);
  });

  it('hands the chat to the team and then keeps quiet', async () => {
    await setup();
    await post(text('תור'));
    await post(tap('human'));
    expect(last().text).toMatch(/^בסדר! העברנו את השיחה לצוות/);
    const before = whatsapp.sent.length;
    await post(text('אז מתי יש תור?'));
    expect(whatsapp.sent).toHaveLength(before);
  });

  it('a message that is not a choice repeats the question; "ביטול" ends it', async () => {
    await setup();
    await post(text('תור'));
    await post(text('מה?'));
    expect(last().text).toMatch(/^לא הבנתי/);
    expect(last().choices!.at(-1)!.id).toBe('human');
    await post(text('ביטול'));
    expect(last().text).toMatch(/^בוטל/);
    expect(await ctx.prisma.whatsAppBotSession.count()).toBe(0);
  });

  it('never answers personal numbers, ordinary chats, or a chat the team is in', async () => {
    const { owner } = await setup();
    await ctx.prisma.whatsAppNumber.create({
      data: { businessId: BUSINESS_ID, phone: '+972507770000', status: 'PERSONAL' },
    });
    await post(text('בא לך לקבוע תור לקפה?', '972507770000'));
    expect(whatsapp.sent).toHaveLength(0);

    // A known customer chatting (no booking words) gets no menu.
    const number = await ctx.prisma.whatsAppNumber.create({
      data: { businessId: BUSINESS_ID, phone: `+${FROM}`, status: 'BUSINESS' },
    });
    await post(text('תודה רבה!'));
    await post(text('נתראה'));
    expect(whatsapp.sent).toHaveLength(0);

    // The owner replied in the chat: the bot doesn't interrupt, even when asked for a time.
    await ctx.prisma.whatsAppMessage.create({
      data: {
        businessId: BUSINESS_ID,
        numberId: number.id,
        direction: 'OUT',
        waMessageId: 'wamid.owner-1',
        body: 'היי! מה שלומך?',
        status: 'sent',
        senderId: owner.userId,
      },
    });
    await post(text('אפשר תור למחר?'));
    expect(whatsapp.sent).toHaveLength(0);
  });

  it("uses the business's own messages with the placeholders filled in", async () => {
    const { owner } = await setup({ services: 1 });
    const put = await req(ctx.app, 'PUT', wp.bot(BUSINESS_ID), owner.token, {
      enabled: true,
      autoConfirm: true,
      texts: {
        greeting: 'היי מ{business}! בחרו שירות:',
        confirmed: '  נקבע: {service}, {time}. החניה מאחורי הבניין 🚗  ',
        handoff: '',
      },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().settings.texts).toEqual({
      greeting: 'היי מ{business}! בחרו שירות:',
      confirmed: 'נקבע: {service}, {time}. החניה מאחורי הבניין 🚗',
    });

    await post(text('תור'));
    await post(tap(last().choices![0]!.id));
    await post(tap(last().choices![0]!.id));
    await post(tap('ok'));
    expect(last().text).toMatch(
      /^נקבע: תספורת נשים, יום .* בשעה \d{2}:\d{2}\. החניה מאחורי הבניין 🚗$/,
    );

    const bad = await req(ctx.app, 'PUT', wp.bot(BUSINESS_ID), owner.token, {
      enabled: true,
      autoConfirm: true,
      texts: { greeting: 'שלום {name}', pending: 'א'.repeat(601) },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.fields).toMatchObject({
      'texts.greeting':
        'אי אפשר להשתמש בסוגריים מסולסלים { }. כדי להוסיף פרטים, השתמשו בכפתורי ההוספה.',
      'texts.pending': 'ההודעה ארוכה מדי (עד 600 תווים)',
    });
  });

  describe('"in the meantime, take a look" (D-106)', () => {
    async function withShowcase(over: Record<string, unknown> = {}) {
      const ctxs = await setup();
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
      const put = await req(ctx.app, 'PUT', wp.bot(BUSINESS_ID), ctxs.owner.token, {
        enabled: true,
        autoConfirm: true,
        showcase: {
          enabled: true,
          link: 'https://instagram.com/sigalit.hair',
          assetIds: [asset.id],
          ...over,
        },
      });
      expect(put.statusCode).toBe(200);
      return { ...ctxs, asset };
    }
    const texts = () => whatsapp.sent.map((m) => m.text);

    it('after a cancel: the message with its link, the photo as JPEG, and "book" — once a day', async () => {
      await withShowcase();
      await post(text('תור'));
      expect(last().choices!.map((c) => c.id)).toEqual([
        expect.stringMatching(/^svc:/),
        expect.stringMatching(/^svc:/),
        'showcase',
        'human',
      ]);
      whatsapp.clear();
      await post(text('ביטול'));
      expect(texts()).toEqual([
        'בוטל. כשתרצו לקבוע תור, פשוט כתבו לנו "תור" 🙂',
        'בינתיים, הנה הצצה לעבודות שלנו ✂️\nhttps://instagram.com/sigalit.hair',
        '',
        'כשתרצו, אפשר לקבוע תור כאן 👇',
      ]);
      expect(whatsapp.sent[2]!.imageBytes).toBeGreaterThan(0);
      expect(last().choices).toEqual([{ id: 'book', title: '📅 לקביעת תור' }]);
      const number = await ctx.prisma.whatsAppNumber.findFirstOrThrow();
      expect(number.botShowcaseAt).not.toBeNull();

      // "Book" starts again; a second cancel the same day doesn't repeat the showcase.
      await post(tap('book'));
      expect(last().text).toContain('רוצים לקבוע תור?');
      whatsapp.clear();
      await post(text('ביטול'));
      expect(texts()).toEqual(['בוטל. כשתרצו לקבוע תור, פשוט כתבו לנו "תור" 🙂']);
    });

    it('"See our work" sends it on request, even if it was sent today', async () => {
      await withShowcase({ text: 'הצצה ל[שם העסק]: {business} 🎧', link: null });
      await ctx.prisma.whatsAppNumber.create({
        data: {
          businessId: BUSINESS_ID,
          phone: `+${FROM}`,
          status: 'BUSINESS',
          botShowcaseAt: new Date(),
        },
      });
      await post(text('תור'));
      whatsapp.clear();
      await post(tap('showcase'));
      expect(texts()[0]).toBe('הצצה ל[שם העסק]: עיצוב שיער סיגלית 🎧');
      expect(last().choices![0]!.id).toBe('book');
    });

    it('talking to the team gets it too, and "book" reopens the bot', async () => {
      await withShowcase();
      await post(text('תור'));
      whatsapp.clear();
      await post(tap('human'));
      expect(texts()[0]).toMatch(/^בסדר! העברנו את השיחה לצוות/);
      expect(last().choices![0]!.id).toBe('book');
      await post(tap('book'));
      expect(last().text).toContain('רוצים לקבוע תור?');
    });

    it('a conversation that stopped in the middle gets it after 30 minutes, once', async () => {
      const { owner } = await withShowcase();
      await post(text('תור'));
      await post(tap(last().choices![0]!.id));
      await ctx.prisma
        .$executeRaw`UPDATE whatsapp_bot_sessions SET updated_at = now() - interval '40 minutes'`;
      whatsapp.clear();
      const service = new WhatsAppService(
        ctx.prisma,
        ctx.app.config,
        whatsapp,
        ctx.app.log,
        ctx.app.storage,
      );
      expect(await service.nudgeAbandonedBookings()).toBe(1);
      expect(texts()[0]).toMatch(/^בינתיים, הנה הצצה לעבודות שלנו/);
      expect(await ctx.prisma.whatsAppBotSession.count()).toBe(0);
      expect(await service.nudgeAbandonedBookings()).toBe(0);

      // Not while the team is talking in the chat.
      const number = await ctx.prisma.whatsAppNumber.findFirstOrThrow();
      await ctx.prisma.whatsAppNumber.update({
        where: { id: number.id },
        data: { botShowcaseAt: null },
      });
      await post(text('תור'));
      await ctx.prisma.whatsAppMessage.create({
        data: {
          businessId: BUSINESS_ID,
          numberId: number.id,
          direction: 'OUT',
          waMessageId: 'wamid.owner-x',
          body: 'אני כאן!',
          status: 'sent',
          senderId: owner.userId,
        },
      });
      await ctx.prisma
        .$executeRaw`UPDATE whatsapp_bot_sessions SET updated_at = now() - interval '40 minutes'`;
      expect(await service.nudgeAbandonedBookings()).toBe(0);
    });

    it("off by default; checks the link and that the photos are the business's own", async () => {
      const { owner } = await setup();
      const get = await req(ctx.app, 'GET', wp.bot(BUSINESS_ID), owner.token);
      expect(get.json().settings.showcase).toEqual({
        enabled: false,
        defaultText: 'בינתיים, הנה הצצה לעבודות שלנו ✂️',
        link: null,
        assetIds: [],
      });
      const bad = (showcase: object) =>
        req(ctx.app, 'PUT', wp.bot(BUSINESS_ID), owner.token, {
          enabled: true,
          autoConfirm: true,
          showcase,
        });
      const link = await bad({ enabled: true, link: 'instagram.com/x' });
      expect(link.statusCode).toBe(400);
      expect(link.json().error.fields['showcase.link']).toBe(
        'יש להזין קישור מלא שמתחיל ב־https://',
      );
      const other = await ctx.prisma.business.create({ data: { name: 'אחר', industry: 'beauty' } });
      const foreign = await ctx.prisma.asset.create({
        data: {
          businessId: other.id,
          key: `${other.id}/${randomUUID()}.webp`,
          mime: 'image/webp',
          sizeBytes: 1,
          width: 1,
          height: 1,
        },
      });
      const img = await bad({ enabled: true, assetIds: [foreign.id] });
      expect(img.statusCode).toBe(400);
      expect(img.json().error.fields['showcase.assetIds']).toMatch(/כבר לא קיימת/);
    });
  });

  describe('event requests (D-107)', () => {
    const inMonths = (n: number) => {
      const d = new Date();
      d.setMonth(d.getMonth() + n);
      return d;
    };
    const typed = (d: Date) => `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
    const ymd = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    it('a DJ: event type, typed date, part of day, guests, area → a request the team confirms', async () => {
      const { owner } = await setup({ industry: 'events', services: 0, name: 'DJ רון' });
      await post(text('היי, אפשר לבדוק תאריך לחתונה?'));
      // First it asks how to help, before any question (D-108).
      expect(last().text).toBe('היי! כאן DJ רון 🎧\nאיך אפשר לעזור?');
      expect(last().choices!.map((c) => c.id)).toEqual(['ev_start', 'human']);
      await post(tap('ev_start'));
      expect(last().text).toBe('איזה אירוע אתם מתכננים? בחרו:');
      expect(last().choices!.map((c) => c.title)).toEqual([
        'חתונה',
        'בר/בת מצווה',
        'יום הולדת',
        'אירוע חברה',
        'מסיבה פרטית',
        'אחר',
        'דברו עם הצוות',
      ]);
      await post(tap('evt:t0'));
      expect(last().text).toMatch(/^חתונה, מעולה! 🎉\nלאיזה תאריך\?/);

      await post(text('מתי שנוח'));
      expect(last().text).toMatch(/^לא הצלחתי להבין את התאריך/);
      const day = inMonths(4);
      await post(text(`בתאריך ${typed(day)} בערב`));
      expect(last().text).toMatch(/התאריך פנוי 👍\nבאיזה חלק של היום\?$/);
      expect(last().choices!.map((c) => c.id)).toEqual([
        'part:day',
        'part:evening',
        'part:unknown',
      ]);
      await post(tap('part:evening'));
      expect(last().text).toBe('כמה אורחים בערך?');
      await post(tap('guests:2'));
      expect(last().text).toBe('ובאיזה אזור או עיר?');
      await post(text('  ראשון   לציון '));
      expect(last().text).toMatch(
        /^לסיכום:\n• חתונה\n• .*, ערב\n• אורחים: 150–300\n• אזור: ראשון לציון\n\nלשלוח את הבקשה\?$/,
      );
      await post(tap('ev_send'));
      expect(last().text).toMatch(
        /^תודה! קיבלנו את הפרטים לחתונה ב.* 🙏\nנחזור אליכם בהקדם עם הצעה מסודרת\.$/,
      );

      const appt = await ctx.prisma.appointment.findFirstOrThrow();
      expect(appt).toMatchObject({ status: 'REQUESTED', source: 'whatsapp', staffId: null });
      expect(appt.startsAt).toEqual(zonedTimeToUtc(ymd(day), '19:00', TZ));
      expect(appt.notes).toMatch(/^בקשה מוואטסאפ · חתונה · /);
      expect(appt.notes).toContain('אורחים: 150–300 · אזור: ראשון לציון');
      // It waits for the team in the pending requests.
      const requests = await req(
        ctx.app,
        'GET',
        apiPaths.appointments.requests(BUSINESS_ID),
        owner.token,
      );
      expect(requests.json().appointments).toHaveLength(1);
      const lead = await ctx.prisma.lead.findFirstOrThrow();
      expect(appt.leadId).toBe(lead.id);
    });

    it('a taken date offers another one', async () => {
      const { owner } = await setup({ industry: 'events', services: 0 });
      const day = inMonths(3);
      const contact = await ctx.prisma.contact.create({
        data: { businessId: BUSINESS_ID, name: 'אחר', phone: '+972509999999' },
      });
      await ctx.prisma.appointment.create({
        data: {
          businessId: BUSINESS_ID,
          contactId: contact.id,
          staffId: owner.userId,
          startsAt: zonedTimeToUtc(ymd(day), '19:00', TZ),
          endsAt: zonedTimeToUtc(ymd(day), '23:00', TZ),
        },
      });
      await post(text('אירוע'));
      await post(tap('ev_start'));
      await post(tap('evt:t3'));
      await post(text(typed(day)));
      expect(last().text).toBe('התאריך הזה כבר תפוס אצלנו 😕 רוצים לבדוק תאריך אחר?');
      expect(last().choices!.map((c) => c.id)).toEqual(['other_date', 'human']);
      await post(text(typed(inMonths(5))));
      expect(last().text).toMatch(/התאריך פנוי/);
    });

    it("a photographer uses its services and doesn't ask for guests", async () => {
      await setup({ industry: 'photo', services: 2, name: 'סטודיו אור' });
      await post(text('הזמנה לצילום'));
      expect(last().text).toBe('היי! כאן סטודיו אור 📸\nאיך אפשר לעזור?');
      await post(tap('ev_start'));
      expect(last().text).toBe('מה מצלמים? בחרו:');
      await post(tap(last().choices![0]!.id));
      await post(text(typed(inMonths(2))));
      await post(tap('part:day'));
      expect(last().text).toBe('ובאיזה אזור או עיר?');
    });

    it('the business can switch the flow either way', async () => {
      const { owner } = await setup({ industry: 'beauty' });
      const get = (await req(ctx.app, 'GET', wp.bot(BUSINESS_ID), owner.token)).json();
      expect(get.settings).toMatchObject({ flow: 'appointment', flowIsDefault: true });
      expect(get.settings.defaults.greeting).toBe(
        'שלום! כאן {business} 👋\nרוצים לקבוע תור? בחרו שירות:',
      );
      const put = await req(ctx.app, 'PUT', wp.bot(BUSINESS_ID), owner.token, {
        enabled: true,
        autoConfirm: true,
        flow: 'event',
      });
      expect(put.json().settings).toMatchObject({ flow: 'event', flowIsDefault: false });
      await post(text('תור'));
      await post(tap('ev_start'));
      expect(last().choices!.map((c) => c.id)).toContain(
        'evt:svc:' + (await ctx.prisma.service.findFirstOrThrow({ orderBy: { name: 'asc' } })).id,
      );
    });
  });

  describe('a personal touch (D-108)', () => {
    const inMonths = (n: number) => {
      const d = new Date();
      d.setMonth(d.getMonth() + n);
      return d;
    };
    const typed = (d: Date) => `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;

    it('"can I talk to you about my wedding" goes straight to the owner, no menu', async () => {
      await setup({ industry: 'events', services: 0, name: 'DJ רון' });
      await post(text('היי, אפשר לדבר איתך על החתונה שלי?'));
      expect(whatsapp.sent.map((m) => m.text)).toEqual([
        'בסדר! העברנו את השיחה לצוות, נחזור אליכם כאן בהקדם 🙂',
      ]);
      expect(last().choices).toBeUndefined();
      // And it stays quiet afterwards.
      await post(text('אז מה, יש תאריך?'));
      expect(whatsapp.sent).toHaveLength(1);
    });

    it('"personal chat" on the first reply hands over too', async () => {
      await setup({ industry: 'events', services: 0 });
      await post(text('היי'));
      await post(tap('human'));
      expect(last().text).toMatch(/^בסדר! העברנו את השיחה לצוות/);
    });

    it('after two messages it cannot understand, it hands the chat to the team', async () => {
      await setup();
      await post(text('תור'));
      await post(text('מה?'));
      expect(last().text).toMatch(/^לא הבנתי/);
      await post(text('לא ברור לי'));
      expect(last().text).toMatch(/^בסדר! העברנו את השיחה לצוות/);
      const before = whatsapp.sent.length;
      await post(text('הלו?'));
      expect(whatsapp.sent).toHaveLength(before);
    });

    it("an event request doesn't hold the date unless the owner chose to", async () => {
      const { owner } = await setup({ industry: 'events', services: 0 });
      const day = typed(inMonths(4));
      const request = async (from: string) => {
        await post(text('אירוע', from));
        await post(
          event(
            {
              type: 'interactive',
              interactive: { type: 'button_reply', button_reply: { id: 'ev_start', title: 'x' } },
            },
            from,
          ),
        );
        await post(
          event(
            {
              type: 'interactive',
              interactive: { type: 'list_reply', list_reply: { id: 'evt:t0', title: 'x' } },
            },
            from,
          ),
        );
        await post(text(day, from));
      };
      await request(FROM);
      await post(tap('part:evening'));
      await post(tap('guests:1'));
      await post(text('חיפה'));
      await post(tap('ev_send'));
      expect(await ctx.prisma.appointment.count({ where: { status: 'REQUESTED' } })).toBe(1);
      // Another customer can still ask for the same date: the owner decides.
      await request('972502223344');
      expect(last().text).toMatch(/התאריך פנוי/);

      await req(ctx.app, 'PUT', wp.bot(BUSINESS_ID), owner.token, {
        enabled: true,
        autoConfirm: true,
        holdDate: true,
      });
      await request('972503334455');
      expect(last().text).toBe('התאריך הזה כבר תפוס אצלנו 😕 רוצים לבדוק תאריך אחר?');
    });

    it('the owner can pause the bot for one customer from the lead', async () => {
      const { owner } = await setup();
      await post(text('תור'));
      const lead = (
        await req(ctx.app, 'POST', apiPaths.leads.list(BUSINESS_ID), owner.token, {
          name: 'נועה לוי',
          phone: '050-1112233',
        })
      ).json().lead as { id: string };
      const pause = await req(ctx.app, 'PUT', wp.botPause(BUSINESS_ID, lead.id), owner.token, {
        paused: true,
      });
      expect(pause.statusCode).toBe(204);
      expect(await ctx.prisma.whatsAppBotSession.count()).toBe(0);
      const thread = (
        await req(ctx.app, 'GET', wp.thread(BUSINESS_ID, lead.id), owner.token)
      ).json();
      expect(thread.botPaused).toBe(true);
      const before = whatsapp.sent.length;
      await post(text('אפשר תור למחר?'));
      expect(whatsapp.sent).toHaveLength(before);

      await req(ctx.app, 'PUT', wp.botPause(BUSINESS_ID, lead.id), owner.token, { paused: false });
      await post(text('אפשר תור למחר?'));
      expect(whatsapp.sent.length).toBeGreaterThan(before);
    });
  });

  it('reads typed dates in the forms people use', () => {
    expect(parseEventDate('14.2.2027', '2026-11-03')).toBe('2027-02-14');
    expect(parseEventDate('ב-14/2/27 בערב', '2026-11-03')).toBe('2027-02-14');
    expect(parseEventDate('14-02', '2026-11-03')).toBe('2027-02-14');
    expect(parseEventDate('20.11', '2026-11-03')).toBe('2026-11-20');
    expect(parseEventDate('31.2.2027', '2026-11-03')).toBeNull();
    expect(parseEventDate('1.1.2026', '2026-11-03')).toBeNull();
    expect(parseEventDate('1.1.2030', '2026-11-03')).toBeNull();
    expect(parseEventDate('מחר', '2026-11-03')).toBeNull();
  });

  it('settings: owners and managers can read and change them, employees cannot', async () => {
    const { owner } = await setup({ enabled: false });
    const get = await req(ctx.app, 'GET', wp.bot(BUSINESS_ID), owner.token);
    expect(get.json()).toEqual({
      connected: true,
      settings: expect.objectContaining({ enabled: false, autoConfirm: true, texts: {} }),
    });
    const put = await req(ctx.app, 'PUT', wp.bot(BUSINESS_ID), owner.token, {
      enabled: true,
      autoConfirm: false,
    });
    expect(put.json().settings).toMatchObject({ enabled: true, autoConfirm: false, texts: {} });

    const employee = await newUser(ctx.app, 'bot-employee');
    await addMember(ctx.prisma, BUSINESS_ID, employee.userId, 'EMPLOYEE');
    expect((await req(ctx.app, 'GET', wp.bot(BUSINESS_ID), employee.token)).statusCode).toBe(403);
    expect(
      (
        await req(ctx.app, 'PUT', wp.bot(BUSINESS_ID), employee.token, {
          enabled: false,
          autoConfirm: true,
        })
      ).statusCode,
    ).toBe(403);
  });
});

describe('free times (D-102)', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());
  beforeEach(() => resetDb(ctx.prisma));

  it('fits inside opening hours, skips closed days and the next hour, and fills staff by staff', async () => {
    const a = await newUser(ctx.app, 'ft-a');
    const b = await newUser(ctx.app, 'ft-b');
    // A Sunday a week ahead, so "too soon" never matters for it.
    const now = new Date('2030-01-01T08:00:00Z');
    const business = await ctx.prisma.business.create({
      data: {
        name: 'בדיקה',
        industry: 'beauty',
        timezone: TZ,
        openingHours: {
          ...allDay,
          sun: { open: true, from: '09:00', to: '11:00' },
          mon: { open: false, from: '09:00', to: '18:00' },
          tue: { open: true, from: '09:00', to: '12:00' },
        },
      },
    });
    await addMember(ctx.prisma, business.id, a.userId, 'OWNER');
    const sunday = '2030-01-06';
    const monday = addDaysTo(sunday, 1);
    const contact = await ctx.prisma.contact.create({
      data: { businessId: business.id, name: 'x', phone: '+972501234567' },
    });
    const book = (staffId: string, time: string, min: number) =>
      ctx.prisma.appointment.create({
        data: {
          businessId: business.id,
          contactId: contact.id,
          staffId,
          startsAt: zonedTimeToUtc(sunday, time, TZ),
          endsAt: new Date(zonedTimeToUtc(sunday, time, TZ).getTime() + min * 60_000),
        },
      });
    await book(a.userId, '09:30', 60);

    const one = await freeTimes(ctx.prisma, business, [sunday, monday], 60, now);
    // 09:00–11:00 with a 60-minute service, minus anything overlapping 09:30–10:30.
    expect(one.get(sunday)!.map((t) => t.time)).toEqual([]);
    expect(one.get(monday)).toEqual([]);
    const half = await freeTimes(ctx.prisma, business, [sunday], 30, now);
    expect(half.get(sunday)!.map((t) => t.time)).toEqual(['09:00', '10:30']);

    // A second team member makes the busy times free again, on them.
    await addMember(ctx.prisma, business.id, b.userId, 'EMPLOYEE');
    const two = await freeTimes(ctx.prisma, business, [sunday], 60, now);
    expect(two.get(sunday)).toEqual([
      expect.objectContaining({ time: '09:00', staffId: b.userId }),
      expect.objectContaining({ time: '09:30', staffId: b.userId }),
      expect.objectContaining({ time: '10:00', staffId: b.userId }),
    ]);

    // Nothing sooner than an hour from now.
    const tuesday = addDaysTo(sunday, 2);
    const soon = zonedTimeToUtc(tuesday, '09:45', TZ);
    expect(
      (await freeTimes(ctx.prisma, business, [tuesday], 30, soon)).get(tuesday)!.map((t) => t.time),
    ).toEqual(['11:00', '11:30']);
    expect(todayIn(TZ, new Date('2030-01-05T22:30:00Z'))).toBe('2030-01-06');
  });
});
