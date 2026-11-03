import type { Prisma, PrismaClient, WhatsAppBotSession } from '@prisma/client';
import {
  asksGuests,
  BLOCKING_STATUSES,
  BOT_FLOWS,
  botDefaultTextsFor,
  botFlowFor,
  botShowcaseSchema,
  eventTypesFor,
  type BotFlow,
  botTextsSchema,
  fillBotText,
  showcaseDefaultText,
  type BotTextKey,
  type BotTexts,
} from '@leadflow/shared';
import sharp from 'sharp';
import type { z } from 'zod';
import type { StorageProvider } from '../../integrations/storage';
import type { WhatsAppChoice, WhatsAppSender } from '../../integrations/whatsapp';
import type { Db } from '../../lib/db';
import { AppError } from '../../lib/errors';
import { zonedTimeToUtc } from '../../lib/time';
import { addDaysTo, freeTimes, todayIn } from '../appointments/availability';
import { AppointmentService } from '../appointments/service';
import { MANAGERS, notifySafe } from '../notifications/service';

/**
 * WhatsApp booking bot (D-102). A button conversation: service → day → time → confirm → booked.
 * It starts when a customer asks for an appointment (or a new number writes for the first time), never on a
 * personal number, and stays quiet once a team member has written in the chat or the customer
 * asked for a person. Texts to customers are Hebrew (customer-facing copy stays Hebrew, D-100).
 * A customer who doesn't book gets the business's showcase ("in the meantime, take a look", D-106).
 * Event businesses (DJ, catering, photography) use the event-request flow instead (D-107):
 * event type → date (typed) → part of day → guests → area → a request the team confirms.
 */

const SESSION_MS = 30 * 60_000;
const HANDOFF_MS = 12 * 60 * 60_000;
const DAYS_AHEAD = 14;
/** WhatsApp lists hold 10 rows; one is kept for "talk to the team" / "another day". */
const MAX_ROWS = 9;
const DEFAULT_DURATION = 30;
/** The showcase goes to the same customer at most once in this time. */
const SHOWCASE_EVERY_MS = 24 * 60 * 60_000;
/** A conversation that stopped this long ago gets the showcase (inside WhatsApp's 24 h window). */
const ABANDONED_AFTER_MS = 30 * 60_000;
const ABANDONED_UNTIL_MS = 20 * 60 * 60_000;

const TRIGGER = /תור|לקבוע|פנוי|זמינ|אירוע|הזמנ|פגישה|שיעור|חתונה|appointment|book|event/i;
const CHOICE =
  /^(svc:[0-9a-f-]{36}|day:\d{4}-\d{2}-\d{2}|time:\d{2}:\d{2}|evt:(svc:[0-9a-f-]{36}|t\d{1,2})|part:(day|evening|unknown)|guests:\d|ok|other_time|other_day|other_date|ev_send|ev_edit|cancel|human|showcase|book)$/;
/** Steps of a booking in progress (a conversation that stops in one of them gets the showcase). */
const OPEN_STEPS = [
  'service',
  'day',
  'time',
  'confirm',
  'ev_type',
  'ev_date',
  'ev_part',
  'ev_guests',
  'ev_area',
  'ev_confirm',
];

const GUESTS = ['עד 50', '50–150', '150–300', '300+', 'עוד לא יודעים'];
const PARTS = {
  day: { label: 'צהריים', from: '12:00', to: '16:00' },
  evening: { label: 'ערב', from: '19:00', to: '23:00' },
  unknown: { label: 'עוד לא יודעים', from: '19:00', to: '23:00' },
} as const;
type Part = keyof typeof PARTS;
/** What an event request has collected so far (kept on the session). */
interface EventData {
  type?: string;
  part?: Part;
  guests?: string;
  area?: string;
}
const CANCEL_TEXT = /^\s*(ביטול|לבטל|cancel)\s*$/i;
const HUMAN_TEXT = /נציג|לדבר עם|human|agent/i;

const human: WhatsAppChoice = { id: 'human', title: 'דברו עם הצוות' };
const seeOurWork: WhatsAppChoice = { id: 'showcase', title: '📸 העבודות שלנו' };

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
  industry: string;
  timezone: string;
  openingHours: unknown;
  whatsappBotAutoConfirm: boolean;
  texts: BotTexts;
  showcase: z.output<typeof botShowcaseSchema>;
  flow: BotFlow;
};
interface Chat {
  business: Business;
  numberId: string;
  phone: string;
  /** When this customer last got the showcase. */
  showcaseAt: Date | null;
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
const longDate = new Intl.DateTimeFormat('he-IL', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});
const eventDay = (date: string) => longDate.format(noon(date));

/**
 * A date the customer typed — "14.2.2027", "14/2/27", "14-02" (the next 14 February) — as
 * YYYY-MM-DD, from today up to two years ahead; null if it isn't one.
 */
export function parseEventDate(text: string, today: string): string | null {
  const m = /(\d{1,2})\s*[./-]\s*(\d{1,2})(?:\s*[./-]\s*(\d{2,4}))?/.exec(text);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  const [ty] = today.split('-').map(Number) as [number];
  let y = m[3] ? Number(m[3]) : ty;
  if (y < 100) y += 2000;
  const iso = (yy: number) => {
    const t = new Date(Date.UTC(yy, mo - 1, d));
    if (t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
    return t.toISOString().slice(0, 10);
  };
  let date = iso(y);
  if (date && !m[3] && date < today) date = iso(y + 1);
  if (!date || date < today || date > addDaysTo(today, 730)) return null;
  return date;
}

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
    private readonly storage: StorageProvider,
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
    const number = await this.prisma.whatsAppNumber.findUnique({
      where: { businessId_phone: { businessId, phone: msg.from } },
    });
    if (!number || number.status === 'PERSONAL') return 'none';
    const chat = await this.chatFor(businessId, number, now);
    if (!chat) return 'none';
    const choice = msg.replyId && CHOICE.test(msg.replyId) ? msg.replyId : null;

    let session = chat.session;
    if (session && session.expiresAt <= now) {
      await this.prisma.whatsAppBotSession.delete({ where: { id: session.id } });
      session = chat.session = null;
    }
    // "Book now" under the showcase reopens a chat that was handed to the team.
    if (session?.step === 'handoff' && choice === 'book') {
      await this.prisma.whatsAppBotSession.delete({ where: { id: session.id } });
      session = chat.session = null;
    }
    if (session?.step === 'handoff') return 'none';
    if (choice === 'showcase') {
      await this.showcase(chat, { force: true, offerBooking: true });
      return 'handled';
    }
    if (choice === 'book') return this.start(chat, now);

    if (!session) {
      // Asked for an appointment, tapped an old list, or a new number's first message.
      const wants =
        choice ||
        TRIGGER.test(msg.body) ||
        (number.status === 'UNCLASSIFIED' && (await this.isFirstMessage(chat.numberId)));
      if (!wants || (await this.teamIsTalking(chat.numberId, now))) return 'none';
      return this.start(chat, now);
    }

    if (choice === 'human' || (!choice && HUMAN_TEXT.test(msg.body))) {
      return this.handoff(chat, now, this.text(chat, 'handoff'));
    }
    if (choice === 'cancel' || (!choice && CANCEL_TEXT.test(msg.body))) {
      await this.prisma.whatsAppBotSession.delete({ where: { id: session.id } });
      await this.say(
        chat,
        chat.business.flow === 'event'
          ? 'בוטל. כשתרצו, פשוט כתבו לנו כאן 🙂'
          : 'בוטל. כשתרצו לקבוע תור, פשוט כתבו לנו "תור" 🙂',
      );
      await this.showcase(chat, { offerBooking: true });
      return 'handled';
    }
    if (chat.business.flow === 'event') return this.onEvent(chat, choice, msg.body, now);
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
    if (chat.business.flow === 'event') return this.askEventType(chat);
    const services = await this.activeServices(chat.business.id);
    if (services.length === 1) return this.askDay(chat, services[0]!.id, now);
    if (!services.length) return this.askDay(chat, null, now);
    return this.askService(chat);
  }

  private async askService(chat: Chat, prefix = ''): Promise<BotOutcome> {
    const services = await this.activeServices(chat.business.id);
    await this.setSession(chat, { step: 'service', serviceId: null, date: null, time: null });
    const extra = this.hasShowcase(chat) ? [seeOurWork] : [];
    await this.say(chat, `${prefix}${this.text(chat, 'greeting')}`, {
      button: 'בחירת שירות',
      rows: [
        ...services.slice(0, MAX_ROWS - extra.length).map((s) => ({
          id: `svc:${s.id}`,
          title: s.name,
          description: [`${s.durationMin} דק׳`, s.price != null ? `₪${s.price}` : null]
            .filter(Boolean)
            .join(' · '),
        })),
        ...extra,
        human,
      ],
    });
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
    // The first list of the conversation (when services were skipped) offers the showcase too.
    const extra = !chat.session && this.hasShowcase(chat) ? [seeOurWork] : [];
    const days = dates.filter((d) => free.get(d)!.length > 0).slice(0, MAX_ROWS - extra.length);
    if (!days.length) {
      return this.handoff(chat, now, this.text(chat, 'noTimes'), { offerBooking: false });
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
        ...extra,
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
    await this.say(
      chat,
      this.text(chat, business.whatsappBotAutoConfirm ? 'confirmed' : 'pending', {
        service: service?.name,
        when: at,
      }),
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

  private async handoff(
    chat: Chat,
    now: Date,
    text: string,
    { offerBooking = true } = {},
  ): Promise<BotOutcome> {
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
    await this.showcase(chat, { offerBooking });
    return 'handoff';
  }

  /**
   * Conversations that stopped in the middle (no answer for 30 minutes) get the showcase once,
   * while WhatsApp still allows a free-form message. Run by a background job every minute.
   */
  async nudgeAbandoned(now = new Date()): Promise<number> {
    const stale = await this.prisma.whatsAppBotSession.findMany({
      where: {
        step: { in: OPEN_STEPS },
        updatedAt: {
          lt: new Date(now.getTime() - ABANDONED_AFTER_MS),
          gt: new Date(now.getTime() - ABANDONED_UNTIL_MS),
        },
      },
      select: { id: true, businessId: true, numberId: true, updatedAt: true },
      take: 100,
    });
    let sent = 0;
    for (const s of stale) {
      // Claim it: a customer reply in the meantime (updatedAt changes) keeps the conversation.
      const { count } = await this.prisma.whatsAppBotSession.deleteMany({
        where: { id: s.id, updatedAt: s.updatedAt },
      });
      if (!count) continue;
      const number = await this.prisma.whatsAppNumber.findUnique({ where: { id: s.numberId } });
      if (!number || number.status === 'PERSONAL') continue;
      const chat = await this.chatFor(s.businessId, number, now);
      if (!chat || (await this.teamIsTalking(number.id, now))) continue;
      if (await this.showcase(chat, { offerBooking: true })) sent += 1;
    }
    return sent;
  }

  // ---------------------------------------------------------- event requests

  private eventData(chat: Chat): EventData {
    return (chat.session?.data ?? {}) as EventData;
  }

  private async onEvent(
    chat: Chat,
    choice: string | null,
    body: string,
    now: Date,
  ): Promise<BotOutcome> {
    const s = chat.session!;
    if (choice?.startsWith('evt:')) return this.pickEventType(chat, choice.slice(4));
    if (choice === 'ev_edit') return this.askEventType(chat);
    if (choice === 'other_date') return this.askEventDate(chat);
    if (choice?.startsWith('part:') && s.date) return this.pickPart(chat, choice.slice(5) as Part);
    if (choice?.startsWith('guests:')) {
      const guests = GUESTS[Number(choice.slice(7))];
      if (guests) return this.askArea(chat, { ...this.eventData(chat), guests });
    }
    if (choice === 'ev_send' && s.step === 'ev_confirm' && s.date) {
      return this.sendEvent(chat, s.date);
    }
    // Typed answers: the date and the area.
    if (!choice && s.step === 'ev_date') return this.onEventDate(chat, body, now);
    if (!choice && s.step === 'ev_area') {
      const area = body.trim().replace(/\s+/g, ' ').slice(0, 80);
      if (area.length >= 2) return this.askEventConfirm(chat, { ...this.eventData(chat), area });
      await this.say(chat, 'באיזה אזור או עיר יהיה האירוע?');
      return 'handled';
    }
    return this.repeatEvent(chat);
  }

  private async askEventType(chat: Chat, prefix = ''): Promise<BotOutcome> {
    const services = await this.activeServices(chat.business.id);
    const extra = this.hasShowcase(chat) ? [seeOurWork] : [];
    const options: WhatsAppChoice[] = services.length
      ? services.map((sv) => ({
          id: `evt:svc:${sv.id}`,
          title: sv.name,
          ...(sv.price != null ? { description: `החל מ־₪${sv.price}` } : {}),
        }))
      : eventTypesFor(chat.business.industry).map((t, i) => ({ id: `evt:t${i}`, title: t }));
    await this.setSession(chat, {
      step: 'ev_type',
      serviceId: null,
      date: null,
      time: null,
      data: {},
    });
    await this.say(chat, `${prefix}${this.text(chat, 'greeting')}`, {
      button: 'בחירת סוג',
      rows: [...options.slice(0, MAX_ROWS - extra.length), ...extra, human],
    });
    return 'handled';
  }

  private async pickEventType(chat: Chat, id: string): Promise<BotOutcome> {
    let type: string | undefined;
    let serviceId: string | null = null;
    if (id.startsWith('svc:')) {
      const sv = (await this.activeServices(chat.business.id)).find((x) => x.id === id.slice(4));
      type = sv?.name;
      serviceId = sv?.id ?? null;
    } else {
      type = eventTypesFor(chat.business.industry)[Number(id.slice(1))];
    }
    if (!type) return this.askEventType(chat, 'האפשרות הזו כבר לא זמינה. ');
    await this.setSession(chat, {
      step: 'ev_date',
      serviceId,
      date: null,
      time: null,
      data: { type },
    });
    return this.askEventDate(chat, `${type}, מעולה! 🎉\n`);
  }

  private async askEventDate(chat: Chat, prefix = ''): Promise<BotOutcome> {
    const s = chat.session!;
    await this.setSession(chat, {
      step: 'ev_date',
      serviceId: s.serviceId,
      date: null,
      time: null,
      data: this.eventData(chat) as Prisma.InputJsonValue,
    });
    await this.say(chat, `${prefix}לאיזה תאריך? כתבו אותו כאן, למשל 14.2.2027`, {
      buttons: [human],
    });
    return 'handled';
  }

  private async onEventDate(chat: Chat, body: string, now: Date): Promise<BotOutcome> {
    const date = parseEventDate(body, todayIn(chat.business.timezone, now));
    if (!date) {
      await this.say(chat, 'לא הצלחתי להבין את התאריך 🙂 כתבו אותו כך: 14.2.2027');
      return 'handled';
    }
    if (await this.dateTaken(chat, date)) {
      await this.say(chat, this.text(chat, 'dateTaken'), {
        buttons: [{ id: 'other_date', title: 'תאריך אחר' }, human],
      });
      return 'handled';
    }
    await this.setSession(chat, {
      step: 'ev_part',
      serviceId: chat.session!.serviceId,
      date,
      time: null,
      data: this.eventData(chat) as Prisma.InputJsonValue,
    });
    await this.say(chat, `${eventDay(date)} — התאריך פנוי 👍\nבאיזה חלק של היום?`, {
      buttons: (Object.keys(PARTS) as Part[]).map((k) => ({
        id: `part:${k}`,
        title: PARTS[k].label,
      })),
    });
    return 'handled';
  }

  private async pickPart(chat: Chat, part: Part): Promise<BotOutcome> {
    if (!(part in PARTS)) return this.repeatEvent(chat);
    const data: EventData = { ...this.eventData(chat), part };
    if (!asksGuests(chat.business.industry)) return this.askArea(chat, data);
    await this.setSession(chat, {
      step: 'ev_guests',
      serviceId: chat.session!.serviceId,
      date: chat.session!.date,
      time: null,
      data: data as Prisma.InputJsonValue,
    });
    await this.say(chat, 'כמה אורחים בערך?', {
      button: 'מספר אורחים',
      rows: GUESTS.map((g, i) => ({ id: `guests:${i}`, title: g })),
    });
    return 'handled';
  }

  private async askArea(chat: Chat, data: EventData): Promise<BotOutcome> {
    await this.setSession(chat, {
      step: 'ev_area',
      serviceId: chat.session!.serviceId,
      date: chat.session!.date,
      time: null,
      data: data as Prisma.InputJsonValue,
    });
    await this.say(chat, 'ובאיזה אזור או עיר?');
    return 'handled';
  }

  private eventSummary(date: string, d: EventData): string[] {
    return [
      d.type ?? '',
      `${eventDay(date)}${d.part && d.part !== 'unknown' ? `, ${PARTS[d.part].label}` : ''}`,
      ...(d.guests ? [`אורחים: ${d.guests}`] : []),
      ...(d.area ? [`אזור: ${d.area}`] : []),
    ].filter(Boolean);
  }

  private async askEventConfirm(chat: Chat, data: EventData): Promise<BotOutcome> {
    const date = chat.session!.date!;
    await this.setSession(chat, {
      step: 'ev_confirm',
      serviceId: chat.session!.serviceId,
      date,
      time: null,
      data: data as Prisma.InputJsonValue,
    });
    const lines = this.eventSummary(date, data).map((l) => `• ${l}`);
    await this.say(chat, `לסיכום:\n${lines.join('\n')}\n\nלשלוח את הבקשה?`, {
      buttons: [
        { id: 'ev_send', title: 'כן, לשלוח' },
        { id: 'ev_edit', title: 'לשנות' },
        { id: 'cancel', title: 'ביטול' },
      ],
    });
    return 'handled';
  }

  /** A date is taken when it already has as many held events as there are team members. */
  private async dateTaken(chat: Chat, date: string): Promise<boolean> {
    const tz = chat.business.timezone;
    const [held, team] = await Promise.all([
      this.prisma.appointment.count({
        where: {
          businessId: chat.business.id,
          status: { in: BLOCKING_STATUSES },
          startsAt: { lt: zonedTimeToUtc(addDaysTo(date, 1), '00:00', tz) },
          endsAt: { gt: zonedTimeToUtc(date, '00:00', tz) },
        },
      }),
      this.prisma.membership.count({ where: { businessId: chat.business.id, status: 'ACTIVE' } }),
    ]);
    return held >= Math.max(1, team);
  }

  private async sendEvent(chat: Chat, date: string): Promise<BotOutcome> {
    const { business } = chat;
    const data = this.eventData(chat);
    if (await this.dateTaken(chat, date)) {
      await this.say(chat, this.text(chat, 'dateTaken'), {
        buttons: [{ id: 'other_date', title: 'תאריך אחר' }, human],
      });
      return 'handled';
    }
    const part = PARTS[data.part ?? 'unknown'];
    const booked = await this.prisma.$transaction(async (tx) => {
      const customer = await this.ensureCustomer(tx, business.id, chat.numberId);
      await this.appointments.requestEventFromWhatsApp(tx, {
        businessId: business.id,
        ...customer,
        serviceId: chat.session?.serviceId ?? null,
        startsAt: zonedTimeToUtc(date, part.from, business.timezone),
        endsAt: zonedTimeToUtc(date, part.to, business.timezone),
        notes: ['בקשה מוואטסאפ', ...this.eventSummary(date, data)].join(' · '),
        eventType: data.type ?? 'אירוע',
      });
      await tx.whatsAppBotSession.deleteMany({ where: { numberId: chat.numberId } });
      return customer;
    });
    chat.link = booked;
    chat.session = null;
    await this.say(
      chat,
      this.text(chat, 'eventReceived', { service: data.type ?? 'האירוע', when: eventDay(date) }),
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
        when: `${data.type ?? 'אירוע'} · ${eventDay(date)}`,
        pending: true,
      },
      to: { roles: MANAGERS },
    });
    return 'handled';
  }

  /** Not one of the choices: ask the current question of the event request again. */
  private async repeatEvent(chat: Chat): Promise<BotOutcome> {
    const s = chat.session!;
    const prefix = 'לא הבנתי 🙂 בחרו מהאפשרויות, או כתבו "נציג" כדי לדבר עם הצוות.\n\n';
    const data = this.eventData(chat);
    if (s.step === 'ev_part' && s.date) {
      await this.say(chat, prefix.trim());
      chat.session = { ...s, step: 'ev_date' };
      return this.onEventDate(chat, s.date.split('-').reverse().join('.'), chat.now);
    }
    if (s.step === 'ev_guests') return this.pickPart(chat, data.part ?? 'unknown');
    if (s.step === 'ev_confirm') return this.askEventConfirm(chat, data);
    return this.askEventType(chat, prefix);
  }

  // -------------------------------------------------------------- showcase

  private hasShowcase(chat: Chat) {
    return chat.business.showcase.enabled;
  }

  /**
   * "In the meantime, take a look" (D-106): the message with its link, up to 3 photos, and a
   * "book" button. At most once a day per customer unless asked for. Returns whether it was sent.
   */
  private async showcase(
    chat: Chat,
    { force = false, offerBooking = false }: { force?: boolean; offerBooking?: boolean },
  ): Promise<boolean> {
    const sc = chat.business.showcase;
    if (!sc.enabled) return false;
    if (
      !force &&
      chat.showcaseAt &&
      chat.now.getTime() - chat.showcaseAt.getTime() < SHOWCASE_EVERY_MS
    ) {
      return false;
    }
    const text = fillBotText(sc.text ?? showcaseDefaultText(chat.business.industry), {
      business: chat.business.name,
      service: 'תור',
      when: '',
    });
    await this.say(chat, sc.link ? `${text}\n${sc.link}` : text, undefined, {
      preview: Boolean(sc.link),
    });

    const assets = sc.assetIds.length
      ? await this.prisma.asset.findMany({
          where: { id: { in: sc.assetIds }, businessId: chat.business.id },
          select: { id: true, key: true },
        })
      : [];
    for (const id of sc.assetIds) {
      const asset = assets.find((a) => a.id === id);
      const file = asset ? await this.storage.get(asset.key) : null;
      if (!file) continue;
      try {
        // WhatsApp takes JPEG or PNG; the library keeps WebP.
        const jpeg = await sharp(file)
          .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
          .flatten({ background: '#ffffff' })
          .jpeg({ quality: 85 })
          .toBuffer();
        await this.sayImage(chat, jpeg);
      } catch (err) {
        this.log.error({ errName: (err as Error)?.name }, 'whatsapp showcase image failed');
      }
    }
    if (offerBooking) {
      await this.say(chat, 'כשתרצו, אפשר לקבוע תור כאן 👇', {
        buttons: [{ id: 'book', title: '📅 לקביעת תור' }],
      });
    }
    chat.showcaseAt = chat.now;
    await this.prisma.whatsAppNumber.update({
      where: { id: chat.numberId },
      data: { botShowcaseAt: chat.now },
    });
    return true;
  }

  // ---------------------------------------------------------------- helpers

  /** Everything the bot needs about this business and chat; null when the bot is off. */
  private async chatFor(
    businessId: string,
    number: { id: string; phone: string; status: string; botShowcaseAt: Date | null },
    now: Date,
  ): Promise<Chat | null> {
    const business = await this.prisma.business.findUnique({
      where: { id: businessId },
      select: {
        id: true,
        name: true,
        industry: true,
        timezone: true,
        openingHours: true,
        whatsappBotEnabled: true,
        whatsappBotAutoConfirm: true,
        whatsappBotTexts: true,
        whatsappBotShowcase: true,
        whatsappBotFlow: true,
      },
    });
    if (!business?.whatsappBotEnabled) return null;
    const flow = (BOT_FLOWS as readonly string[]).includes(business.whatsappBotFlow ?? '')
      ? (business.whatsappBotFlow as BotFlow)
      : botFlowFor(business.industry);
    const texts = botTextsSchema.safeParse(business.whatsappBotTexts ?? {});
    const showcase = botShowcaseSchema.safeParse(
      business.whatsappBotShowcase ?? { enabled: false },
    );
    return {
      business: {
        ...business,
        flow,
        texts: texts.success ? texts.data : {},
        showcase: showcase.success
          ? showcase.data
          : { enabled: false, text: undefined, link: null, assetIds: [] },
      },
      numberId: number.id,
      phone: number.phone,
      showcaseAt: number.botShowcaseAt,
      link: await this.linkOf(businessId, number.status, number.phone),
      session: await this.prisma.whatsAppBotSession.findUnique({
        where: { numberId: number.id },
      }),
      now,
    };
  }

  /** The business's wording for a message, or the default, with the placeholders filled in. */
  private text(chat: Chat, key: BotTextKey, values: { service?: string; when?: string } = {}) {
    return fillBotText(
      chat.business.texts[key] ?? botDefaultTextsFor(chat.business.industry)[key],
      {
        business: chat.business.name,
        service: values.service ?? 'תור',
        when: values.when ?? '',
      },
    );
  }

  private async setSession(
    chat: Chat,
    data: Pick<WhatsAppBotSession, 'step' | 'serviceId' | 'date' | 'time'> & {
      data?: Prisma.InputJsonValue;
    },
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
    opts: { preview?: boolean } = {},
  ) {
    const options = choices ? ('buttons' in choices ? choices.buttons : choices.rows) : [];
    let id: string;
    try {
      ({ id } = !choices
        ? await this.sender.sendText(chat.phone, body, opts)
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

  /** Sends and stores a photo (shown in LeadFlow as "[תמונה]"). */
  private async sayImage(chat: Chat, jpeg: Buffer) {
    const { id } = await this.sender.sendImage(chat.phone, jpeg);
    await this.prisma.whatsAppMessage.create({
      data: {
        businessId: chat.business.id,
        numberId: chat.numberId,
        contactId: chat.link.contactId,
        leadId: chat.link.leadId,
        direction: 'OUT',
        waMessageId: id,
        body: '[תמונה]',
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
