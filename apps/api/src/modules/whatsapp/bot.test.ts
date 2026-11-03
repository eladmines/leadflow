import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { apiPaths, WEEKDAYS } from '@leadflow/shared';
import { createTestApp, resetDb, testConfig } from '../../../test/helpers';
import { addMember, newUser, req } from '../../../test/business-helpers';
import { MemoryWhatsAppSender, signWebhookBody } from '../../integrations/whatsapp';
import { MemoryEmailSender } from '../../integrations/email';
import { buildApp } from '../../app';
import { addDaysTo, freeTimes, todayIn } from '../appointments/availability';
import { zonedTimeToUtc } from '../../lib/time';

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

  async function setup({ enabled = true, autoConfirm = true, services = 2 } = {}) {
    const owner = await newUser(ctx.app, 'bot-owner');
    await ctx.prisma.business.create({
      data: {
        id: BUSINESS_ID,
        name: 'עיצוב שיער סיגלית',
        industry: 'beauty',
        status: 'ACTIVE',
        timezone: TZ,
        openingHours: allDay,
        whatsappBotEnabled: enabled,
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
    const date = last().choices![0]!.id.slice(4);
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

  it('settings: owners and managers can read and change them, employees cannot', async () => {
    const { owner } = await setup({ enabled: false });
    const get = await req(ctx.app, 'GET', wp.bot(BUSINESS_ID), owner.token);
    expect(get.json()).toEqual({
      connected: true,
      settings: { enabled: false, autoConfirm: true, texts: {} },
    });
    const put = await req(ctx.app, 'PUT', wp.bot(BUSINESS_ID), owner.token, {
      enabled: true,
      autoConfirm: false,
    });
    expect(put.json().settings).toEqual({ enabled: true, autoConfirm: false, texts: {} });

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
