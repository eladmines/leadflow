import type { PrismaClient, WhatsAppBotSession } from '@prisma/client';
import type { WhatsAppChoice, WhatsAppSender } from '../../integrations/whatsapp';
import type { Db } from '../../lib/db';
import { AppError } from '../../lib/errors';
import { addDaysTo, freeTimes, todayIn } from '../appointments/availability';
import { AppointmentService } from '../appointments/service';
import { MANAGERS, notifySafe } from '../notifications/service';

/**
 * WhatsApp booking bot (D-102). A button conversation: service → day → time → confirm → booked.
 * It starts when a customer asks for an appointment (or a new number writes for the first time), never on a
 * personal number, and stays quiet once a team member has written in the chat or the customer
 * asked for a person. Texts to customers are Hebrew (customer-facing copy stays Hebrew, D-100).
 */

const SESSION_MS = 30 * 60_000;
const HANDOFF_MS = 12 * 60 * 60_000;
const DAYS_AHEAD = 14;
/** WhatsApp lists hold 10 rows; one is kept for "talk to the team" / "another day". */
const MAX_ROWS = 9;
const DEFAULT_DURATION = 30;

const TRIGGER = /תור|לקבוע|פנוי|זמינ|appointment|book/i;
const CHOICE =
  /^(svc:[0-9a-f-]{36}|day:\d{4}-\d{2}-\d{2}|time:\d{2}:\d{2}|ok|other_time|other_day|cancel|human)$/;
const CANCEL_TEXT = /^\s*(ביטול|לבטל|cancel)\s*$/i;
const HUMAN_TEXT = /נציג|לדבר עם|human|agent/i;

const human: WhatsAppChoice = { id: 'human', title: 'דברו עם הצוות' };

/** What the bot did with a message: answered it, passed the chat to the team, or nothing. */
export type BotOutcome = 'handled' | 'handoff' | 'none';

export interface BotMessage {
  from: string;
  body: string;
  /** Id of the tapped button or list row, if any. */
  replyId: string | null;
}

interface Log {
  error: (obj: object, msg: string) => void;
}

type Business = {
  id: string;
  name: string;
  timezone: string;
  openingHours: unknown;
  whatsappBotAutoConfirm: boolean;
};
interface Chat {
  business: Business;
  numberId: string;
  phone: string;
  /** Contact and lead to file the bot's messages under (business numbers). */
  link: { contactId: string | null; leadId: string | null };
  session: WhatsAppBotSession | null;
  now: Date;
}

const noon = (date: string) => new Date(`${date}T12:00:00Z`);
const shortDay = new Intl.DateTimeFormat('he-IL', {
  weekday: 'short',
  day: 'numeric',
  month: 'numeric',
  timeZone: 'UTC',
});
const longDay = new Intl.DateTimeFormat('he-IL', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
});
const when = (date: string, time: string) => `${longDay.format(noon(date))} בשעה ${time}`;

/** Up to `max` items spread evenly over the list (first and last kept). */
function spread<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  const idx = new Set(
    Array.from({ length: max }, (_, i) => Math.round((i * (items.length - 1)) / (max - 1))),
  );
  return [...idx].map((i) => items[i]!);
}

export class BookingBot {
  private readonly appointments: AppointmentService;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly sender: WhatsAppSender,
    private readonly log: Log,
    /** The contact and open lead for a number; an unclassified number becomes a business one. */
    private readonly ensureCustomer: (
      tx: Db,
      businessId: string,
      numberId: string,
    ) => Promise<{ contactId: string; leadId: string }>,
  ) {
    this.appointments = new AppointmentService(prisma);
  }

  async handle(businessId: string, msg: BotMessage, now = new Date()): Promise<BotOutcome> {
    const business = await this.prisma.business.findUnique({
      where: { id: businessId },
      select: {
        id: true,
        name: true,
        timezone: true,
        openingHours: true,
        whatsappBotEnabled: true,
        whatsappBotAutoConfirm: true,
      },
    });
    if (!business?.whatsappBotEnabled) return 'none';
    const number = await this.prisma.whatsAppNumber.findUnique({
      where: { businessId_phone: { businessId, phone: msg.from } },
    });
    if (!number || number.status === 'PERSONAL') return 'none';

    let session = await this.prisma.whatsAppBotSession.findUnique({
      where: { numberId: number.id },
    });
    if (session && session.expiresAt <= now) {
      await this.prisma.whatsAppBotSession.delete({ where: { id: session.id } });
      session = null;
    }
    if (session?.step === 'handoff') return 'none';

    const chat: Chat = {
      business,
      numberId: number.id,
      phone: number.phone,
      link: await this.linkOf(businessId, number.status, number.phone),
      session,
      now,
    };
    const choice = msg.replyId && CHOICE.test(msg.replyId) ? msg.replyId : null;

    if (!session) {
      // Asked for an appointment, tapped an old list, or a new number's first message.
      const wants =
        choice ||
        TRIGGER.test(msg.body) ||
        (number.status === 'UNCLASSIFIED' && (await this.isFirstMessage(number.id)));
      if (!wants || (await this.teamIsTalking(number.id, now))) return 'none';
      return this.start(chat, now);
    }

    if (choice === 'human' || (!choice && HUMAN_TEXT.test(msg.body))) {
      return this.handoff(chat, now, 'בסדר! העברנו את השיחה לצוות, נחזור אליכם כאן בהקדם 🙂');
    }
    if (choice === 'cancel' || (!choice && CANCEL_TEXT.test(msg.body))) {
      await this.prisma.whatsAppBotSession.delete({ where: { id: session.id } });
      await this.say(chat, 'בוטל. כשתרצו לקבוע תור, פשוט כתבו לנו "תור" 🙂');
      return 'handled';
    }
    if (choice?.startsWith('svc:')) return this.pickService(chat, choice.slice(4), now);
    if (choice?.startsWith('day:')) return this.askTime(chat, choice.slice(4), now);
    if (choice?.startsWith('time:') && session.date) {
      return this.askConfirm(chat, session.date, choice.slice(5));
    }
    if (choice === 'other_day') return this.askDay(chat, session.serviceId, now);
    if (choice === 'other_time' && session.date) return this.askTime(chat, session.date, now);
    if (choice === 'ok' && session.step === 'confirm' && session.date && session.time) {
      return this.book(chat, session.date, session.time, now);
    }
    return this.repeat(chat, now);
  }

  // ------------------------------------------------------------------ steps

  private async start(chat: Chat, now: Date): Promise<BotOutcome> {
    const services = await this.activeServices(chat.business.id);
    if (services.length === 1) return this.askDay(chat, services[0]!.id, now);
    if (!services.length) return this.askDay(chat, null, now);
    return this.askService(chat);
  }

  private async askService(chat: Chat, prefix = ''): Promise<BotOutcome> {
    const services = await this.activeServices(chat.business.id);
    await this.setSession(chat, { step: 'service', serviceId: null, date: null, time: null });
    await this.say(
      chat,
      `${prefix}שלום! כאן ${chat.business.name} 👋\nרוצים לקבוע תור? בחרו שירות:`,
      {
        button: 'בחירת שירות',
        rows: [
          ...services.slice(0, MAX_ROWS).map((s) => ({
            id: `svc:${s.id}`,
            title: s.name,
            description: [`${s.durationMin} דק׳`, s.price != null ? `₪${s.price}` : null]
              .filter(Boolean)
              .join(' · '),
          })),
          human,
        ],
      },
    );
    return 'handled';
  }

  private async pickService(chat: Chat, serviceId: string, now: Date): Promise<BotOutcome> {
    const service = (await this.activeServices(chat.business.id)).find((s) => s.id === serviceId);
    if (!service) return this.askService(chat, 'השירות הזה כבר לא זמין. ');
    return this.askDay(chat, service.id, now);
  }

  private async askDay(
    chat: Chat,
    serviceId: string | null,
    now: Date,
    prefix = '',
  ): Promise<BotOutcome> {
    const today = todayIn(chat.business.timezone, now);
    const dates = Array.from({ length: DAYS_AHEAD }, (_, i) => addDaysTo(today, i));
    const free = await freeTimes(
      this.prisma,
      chat.business,
      dates,
      await this.duration(chat.business.id, serviceId),
      now,
    );
    const days = dates.filter((d) => free.get(d)!.length > 0).slice(0, MAX_ROWS);
    if (!days.length) {
      return this.handoff(
        chat,
        now,
        'מצטערים, אין כרגע זמנים פנויים בשבועיים הקרובים. העברנו את הפנייה לצוות ונחזור אליכם כאן 🙏',
      );
    }
    await this.setSession(chat, { step: 'day', serviceId, date: null, time: null });
    const tomorrow = addDaysTo(today, 1);
    await this.say(chat, `${prefix}באיזה יום נוח לכם?`, {
      button: 'בחירת יום',
      rows: [
        ...days.map((d) => {
          const n = free.get(d)!.length;
          const label = shortDay.format(noon(d));
          return {
            id: `day:${d}`,
            title: d === today ? `היום · ${label}` : d === tomorrow ? `מחר · ${label}` : label,
            description: n === 1 ? 'זמן פנוי אחד' : `${n} זמנים פנויים`,
          };
        }),
        human,
      ],
    });
    return 'handled';
  }

  private async askTime(chat: Chat, date: string, now: Date, prefix = ''): Promise<BotOutcome> {
    const serviceId = chat.session?.serviceId ?? null;
    const today = todayIn(chat.business.timezone, now);
    if (date < today || date > addDaysTo(today, DAYS_AHEAD))
      return this.askDay(chat, serviceId, now);
    const times = await this.timesOn(chat, date, serviceId, now);
    if (!times.length) {
      return this.askDay(chat, serviceId, now, 'היום הזה כבר התמלא. ');
    }
    await this.setSession(chat, { step: 'time', serviceId, date, time: null });
    await this.say(chat, `${prefix}באיזו שעה? (${longDay.format(noon(date))})`, {
      button: 'בחירת שעה',
      rows: [
        ...spread(times, MAX_ROWS).map((t) => ({ id: `time:${t.time}`, title: t.time })),
        { id: 'other_day', title: 'יום אחר' },
      ],
    });
    return 'handled';
  }

  private async askConfirm(chat: Chat, date: string, time: string): Promise<BotOutcome> {
    const serviceId = chat.session?.serviceId ?? null;
    const service = serviceId ? await this.serviceById(chat.business.id, serviceId) : null;
    await this.setSession(chat, { step: 'confirm', serviceId, date, time });
    await this.say(chat, `לקבוע לכם ${service ? service.name : 'תור'} ב${when(date, time)}?`, {
      buttons: [
        { id: 'ok', title: 'כן, לקבוע' },
        { id: 'other_time', title: 'שעה אחרת' },
        { id: 'cancel', title: 'ביטול' },
      ],
    });
    return 'handled';
  }

  private async book(chat: Chat, date: string, time: string, now: Date): Promise<BotOutcome> {
    const { business } = chat;
    const serviceId = chat.session?.serviceId ?? null;
    const service = serviceId ? await this.serviceById(business.id, serviceId) : null;
    const durationMin = service?.durationMin ?? DEFAULT_DURATION;
    const slot = (await this.timesOn(chat, date, serviceId, now)).find((t) => t.time === time);
    const taken = 'אופס, השעה הזו נתפסה הרגע. ';
    if (!slot) return this.askTime(chat, date, now, taken);

    let booked: { contactId: string; leadId: string };
    try {
      booked = await this.prisma.$transaction(async (tx) => {
        const customer = await this.ensureCustomer(tx, business.id, chat.numberId);
        await this.appointments.bookFromWhatsApp(tx, {
          businessId: business.id,
          ...customer,
          serviceId: service?.id ?? null,
          serviceName: service?.name ?? null,
          staffId: slot.staffId,
          startsAt: slot.startsAt,
          durationMin,
          confirmed: business.whatsappBotAutoConfirm,
        });
        await tx.whatsAppBotSession.deleteMany({ where: { numberId: chat.numberId } });
        return customer;
      });
    } catch (err) {
      if (err instanceof AppError && err.code === 'CONFLICT') {
        return this.askTime(chat, date, now, taken);
      }
      throw err;
    }
    chat.link = booked;
    chat.session = null;

    const at = when(date, time);
    const what = service ? `${service.name} ` : '';
    await this.say(
      chat,
      business.whatsappBotAutoConfirm
        ? `מעולה! קבענו לכם ${what}ל${at} ✅\nנתראה ב${business.name}! לשינוי או ביטול, פשוט כתבו לנו כאן.`
        : `קיבלנו את הבקשה ל${what}${at} 🙏\nנאשר לכם כאן בהקדם.`,
    );
    const contact = await this.prisma.contact.findUnique({
      where: { id: booked.contactId },
      select: { name: true },
    });
    await notifySafe(this.prisma, this.log, {
      businessId: business.id,
      type: 'appointment.booked',
      data: {
        leadId: booked.leadId,
        name: contact?.name ?? chat.phone,
        when: at,
        pending: !business.whatsappBotAutoConfirm,
      },
      to: { roles: MANAGERS, userIds: [slot.staffId] },
    });
    return 'handled';
  }

  /** Anything that isn't one of the choices: ask the current question again. */
  private async repeat(chat: Chat, now: Date): Promise<BotOutcome> {
    const s = chat.session!;
    const prefix = 'לא הבנתי 🙂 בחרו מהרשימה, או כתבו "נציג" כדי לדבר עם הצוות.\n\n';
    if (s.step === 'day') return this.askDay(chat, s.serviceId, now, prefix);
    if (s.step === 'time' && s.date) return this.askTime(chat, s.date, now, prefix);
    if (s.step === 'confirm' && s.date && s.time) {
      await this.say(chat, prefix.trim());
      return this.askConfirm(chat, s.date, s.time);
    }
    return this.askService(chat, prefix);
  }

  private async handoff(chat: Chat, now: Date, text: string): Promise<BotOutcome> {
    await this.prisma.whatsAppBotSession.upsert({
      where: { numberId: chat.numberId },
      create: {
        businessId: chat.business.id,
        numberId: chat.numberId,
        step: 'handoff',
        expiresAt: new Date(now.getTime() + HANDOFF_MS),
      },
      update: { step: 'handoff', expiresAt: new Date(now.getTime() + HANDOFF_MS) },
    });
    await this.say(chat, text);
    return 'handoff';
  }

  // ---------------------------------------------------------------- helpers

  private async setSession(
    chat: Chat,
    data: Pick<WhatsAppBotSession, 'step' | 'serviceId' | 'date' | 'time'>,
  ) {
    const expiresAt = new Date(chat.now.getTime() + SESSION_MS);
    chat.session = await this.prisma.whatsAppBotSession.upsert({
      where: { numberId: chat.numberId },
      create: { businessId: chat.business.id, numberId: chat.numberId, ...data, expiresAt },
      update: { ...data, expiresAt },
    });
  }

  /** Sends and stores one bot message (no sender: it shows as an automatic reply). */
  private async say(
    chat: Chat,
    body: string,
    choices?: { buttons: WhatsAppChoice[] } | { button: string; rows: WhatsAppChoice[] },
  ) {
    const options = choices ? ('buttons' in choices ? choices.buttons : choices.rows) : [];
    let id: string;
    try {
      ({ id } = !choices
        ? await this.sender.sendText(chat.phone, body)
        : 'buttons' in choices
          ? await this.sender.sendButtons(chat.phone, body, choices.buttons)
          : await this.sender.sendList(chat.phone, body, choices.button, choices.rows));
    } catch (err) {
      const e = err as { name?: string; status?: number; code?: number | null };
      this.log.error(
        { errName: e?.name, status: e?.status, code: e?.code },
        'whatsapp bot send failed',
      );
      return;
    }
    const stored = [body, ...options.map((o) => `• ${o.title}`)].join('\n');
    await this.prisma.whatsAppMessage.create({
      data: {
        businessId: chat.business.id,
        numberId: chat.numberId,
        contactId: chat.link.contactId,
        leadId: chat.link.leadId,
        direction: 'OUT',
        waMessageId: id,
        body: stored.slice(0, 4096),
        status: 'sent',
      },
    });
  }

  private async linkOf(businessId: string, status: string, phone: string) {
    if (status !== 'BUSINESS') return { contactId: null, leadId: null };
    const contact = await this.prisma.contact.findFirst({
      where: { businessId, phone },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    const lead = contact
      ? await this.prisma.lead.findFirst({
          where: { businessId, contactId: contact.id, stage: { kind: 'OPEN' } },
          orderBy: { createdAt: 'desc' },
          select: { id: true },
        })
      : null;
    return { contactId: contact?.id ?? null, leadId: lead?.id ?? null };
  }

  private async isFirstMessage(numberId: string) {
    const count = await this.prisma.whatsAppMessage.count({
      where: { numberId, direction: 'IN' },
    });
    return count <= 1;
  }

  /** A team member wrote in this chat recently: the bot doesn't interrupt. */
  private async teamIsTalking(numberId: string, now: Date) {
    const recent = await this.prisma.whatsAppMessage.findFirst({
      where: {
        numberId,
        direction: 'OUT',
        senderId: { not: null },
        createdAt: { gt: new Date(now.getTime() - HANDOFF_MS) },
      },
      select: { id: true },
    });
    return Boolean(recent);
  }

  private activeServices(businessId: string) {
    return this.prisma.service.findMany({
      where: { businessId, active: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, durationMin: true, price: true },
    });
  }

  private serviceById(businessId: string, id: string) {
    return this.prisma.service.findFirst({
      where: { id, businessId, active: true },
      select: { id: true, name: true, durationMin: true },
    });
  }

  private async duration(businessId: string, serviceId: string | null) {
    const s = serviceId ? await this.serviceById(businessId, serviceId) : null;
    return s?.durationMin ?? DEFAULT_DURATION;
  }

  private async timesOn(chat: Chat, date: string, serviceId: string | null, now: Date) {
    const free = await freeTimes(
      this.prisma,
      chat.business,
      [date],
      await this.duration(chat.business.id, serviceId),
      now,
    );
    return free.get(date)!;
  }
}
