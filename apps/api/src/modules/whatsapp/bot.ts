import type { Prisma, PrismaClient, WhatsAppBotSession } from '@prisma/client';
import {
  asksGuests,
  eventTypeQuestionFor,
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
  type Language,
} from '@leadflow/shared';
import sharp from 'sharp';
import type { z } from 'zod';
import type { StorageProvider } from '../../integrations/storage';
import type { WhatsAppChoice, WhatsAppSender } from '../../integrations/whatsapp';
import type { Db } from '../../lib/db';
import { AppError } from '../../lib/errors';
import { zonedTimeToUtc } from '../../lib/time';
import { addDaysTo, freeTimes, todayIn } from '../appointments/availability';
import { AutoReplier, languageOf, modeOf, showcaseVideoOf } from './auto-reply';
import { AppointmentService } from '../appointments/service';
import { MANAGERS, notifySafe } from '../notifications/service';

/**
 * WhatsApp booking bot (D-102). A button conversation: service → day → time → confirm → booked.
 * Every message starts it (D-154), never on a personal number, and stays quiet once a team member has written in the chat or the customer
 * asked for a person. Texts to customers are in the business's language (D-143).
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

const CHOICE =
  /^(svc:[0-9a-f-]{36}|day:\d{4}-\d{2}-\d{2}|time:\d{2}:\d{2}|evt:(svc:[0-9a-f-]{36}|t\d{1,2})|part:(day|evening|unknown)|guests:\d|xcl:[0-9a-f-]{36}|xpick:[0-9a-f-]{36}|xcl_no|ok|other_time|other_day|other_date|ev_send|ev_edit|ev_start|cancel|human|showcase|book)$/;
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

const PARTS = {
  day: { from: '12:00', to: '16:00' },
  evening: { from: '19:00', to: '23:00' },
  unknown: { from: '19:00', to: '23:00' },
} as const;
type Part = keyof typeof PARTS;
/** What an event request has collected so far (kept on the session). */
interface EventData {
  type?: string;
  part?: Part;
  guests?: string;
  area?: string;
}
/** "Cancel" anywhere in the message (D-153): stops a booking in progress, or cancels one booked. */
const CANCEL_TEXT = /בטל|ביטול|cancel/i;
/** The customer wants a person (D-108): the bot steps aside. */
const HUMAN_TEXT =
  /נציג|לדבר|להתקשר|תתקשר|תתקשרי|תחזור|תחזרי|שיחה|שאלה|בן אדם|אדם אמיתי|human|agent|call me|talk to/i;
/** Hebrew typed with the keyboard on English (QWERTY → the Israeli layout), e.g. "vhh ,ur". */
const HEBREW_KEYS: Record<string, string> = Object.fromEntries(
  [..."qwertyuiopasdfghjkl;zxcvbnm,./'"].map((k, i) => [
    k,
    [..."/'קראטוןםפשדגכעיחלךףזסבהנמצתץ.,"][i]!,
  ]),
);
/** The message plus, when it has no Hebrew letters, how it reads on the Hebrew layout. */
export function withHebrewLayout(body: string): string {
  if (/[\u0590-\u05FF]/.test(body) || !/[a-z]/i.test(body)) return body;
  const hebrew = [...body.toLowerCase()].map((ch) => HEBREW_KEYS[ch] ?? ch).join('');
  return `${body} ${hebrew}`;
}

/** Misunderstood messages in one conversation before the bot hands it to the team. */
const MAX_MISSES = 2;

/** What the bot says, in the business's language (D-143). */
const WORDS = {
  he: {
    intl: 'he-IL',
    human: 'דברו עם הצוות',
    seeOurWork: '📸 העבודות שלנו',
    guests: ['עד 50', '50–150', '150–300', '300+', 'עוד לא יודעים'],
    parts: { day: 'צהריים', evening: 'ערב', unknown: 'עוד לא יודעים' },
    at: (day: string, time: string) => `${day} בשעה ${time}`,
    cancelledEvent: 'בוטל. כשתרצו, פשוט כתבו לנו כאן 🙂',
    cancelled: 'בוטל. כשתרצו לקבוע תור, פשוט כתבו לנו "תור" 🙂',
    chooseService: 'בחירת שירות',
    minutes: (n: number) => `${n} דק׳`,
    serviceGone: 'השירות הזה כבר לא זמין. ',
    whichDay: 'באיזה יום נוח לכם?',
    chooseDay: 'בחירת יום',
    today: (d: string) => `היום · ${d}`,
    tomorrow: (d: string) => `מחר · ${d}`,
    freeTimes: (n: number) => (n === 1 ? 'זמן פנוי אחד' : `${n} זמנים פנויים`),
    dayFull: 'היום הזה כבר התמלא. ',
    whichTime: (day: string) => `באיזו שעה? (${day})`,
    chooseTime: 'בחירת שעה',
    otherDay: 'יום אחר',
    appointment: 'תור',
    confirm: (what: string, at: string) => `לקבוע לכם ${what} ב${at}?`,
    yesBook: 'כן, לקבוע',
    otherTime: 'שעה אחרת',
    cancel: 'ביטול',
    timeTaken: 'אופס, השעה הזו נתפסה הרגע. ',
    notUnderstood: 'לא הבנתי 🙂 בחרו מהרשימה, או כתבו "נציג" כדי לדבר עם הצוות.\n\n',
    notUnderstoodEvent: 'לא הבנתי 🙂 בחרו מהאפשרויות, או כתבו "נציג" כדי לדבר עם הצוות.\n\n',
    whichAreaEvent: 'באיזה אזור או עיר יהיה האירוע?',
    checkDate: '📅 לבדוק תאריך',
    personalChat: '💬 שיחה אישית',
    from: (price: number) => `החל מ־₪${price}`,
    chooseType: 'בחירת סוג',
    optionGone: 'האפשרות הזו כבר לא זמינה. ',
    great: (type: string) => `${type}, מעולה! 🎉\n`,
    whichDate: 'לאיזה תאריך? כתבו אותו כאן, למשל 14.2.2027',
    badDate: 'לא הצלחתי להבין את התאריך 🙂 כתבו אותו כך: 14.2.2027',
    otherDate: 'תאריך אחר',
    dateFree: (day: string) => `${day} — התאריך פנוי 👍\nבאיזה חלק של היום?`,
    howManyGuests: 'כמה אורחים בערך?',
    guestsButton: 'מספר אורחים',
    whichArea: 'ובאיזה אזור או עיר?',
    guestsLine: (g: string) => `אורחים: ${g}`,
    areaLine: (a: string) => `אזור: ${a}`,
    summary: (lines: string) => `לסיכום:\n${lines}\n\nלשלוח את הבקשה?`,
    yesSend: 'כן, לשלוח',
    change: 'לשנות',
    fromWhatsApp: 'בקשה מוואטסאפ',
    event: 'אירוע',
    theEvent: 'האירוע',
    bookHere: 'כשתרצו, אפשר לקבוע תור כאן 👇',
    bookButton: '📅 לקביעת תור',
    nothingToCancel: 'לא מצאנו תור קרוב לבטל 🙂 רוצים לקבוע תור?',
    whichToCancel: 'איזה תור לבטל?',
    chooseAppointment: 'בחירת תור',
    confirmCancel: (service: string | null, at: string) =>
      service ? `לבטל את התור ל${service} ב${at}?` : `לבטל את התור ב${at}?`,
    yesCancel: 'כן, לבטל',
    keepIt: 'לא, להשאיר',
    kept: 'מעולה, התור נשאר 👍',
    apptCancelled: 'התור בוטל ✅\nרוצים לקבוע מועד אחר? אפשר כאן 👇',
    bookNew: '📅 תור חדש',
  },
  en: {
    intl: 'en-GB',
    human: 'Talk to the team',
    seeOurWork: '📸 Our work',
    guests: ['Up to 50', '50–150', '150–300', '300+', "Don't know yet"],
    parts: { day: 'Afternoon', evening: 'Evening', unknown: "Don't know yet" },
    at: (day: string, time: string) => `${day} at ${time}`,
    cancelledEvent: 'Cancelled. Whenever you like, just write to us here 🙂',
    cancelled: 'Cancelled. Whenever you want to book, just write "book" 🙂',
    chooseService: 'Choose a service',
    minutes: (n: number) => `${n} min`,
    serviceGone: 'That service is no longer available. ',
    whichDay: 'Which day suits you?',
    chooseDay: 'Choose a day',
    today: (d: string) => `Today · ${d}`,
    tomorrow: (d: string) => `Tomorrow · ${d}`,
    freeTimes: (n: number) => (n === 1 ? 'One free time' : `${n} free times`),
    dayFull: 'That day has just filled up. ',
    whichTime: (day: string) => `What time? (${day})`,
    chooseTime: 'Choose a time',
    otherDay: 'Another day',
    appointment: 'an appointment',
    confirm: (what: string, at: string) => `Book ${what} on ${at}?`,
    yesBook: 'Yes, book it',
    otherTime: 'Another time',
    cancel: 'Cancel',
    timeTaken: 'Oops, that time was just taken. ',
    notUnderstood:
      'Sorry, I didn\'t get that 🙂 Choose from the list, or write "agent" to talk to the team.\n\n',
    notUnderstoodEvent:
      'Sorry, I didn\'t get that 🙂 Choose one of the options, or write "agent" to talk to the team.\n\n',
    whichAreaEvent: 'Which area or town will the event be in?',
    checkDate: '📅 Check a date',
    personalChat: '💬 Personal chat',
    from: (price: number) => `From ₪${price}`,
    chooseType: 'Choose a type',
    optionGone: 'That option is no longer available. ',
    great: (type: string) => `${type}, great! 🎉\n`,
    whichDate: 'Which date? Write it here, for example 14/2/2027',
    badDate: "I couldn't understand the date 🙂 Write it like this: 14/2/2027",
    otherDate: 'Another date',
    dateFree: (day: string) => `${day} — the date is free 👍\nWhich part of the day?`,
    howManyGuests: 'About how many guests?',
    guestsButton: 'Number of guests',
    whichArea: 'And which area or town?',
    guestsLine: (g: string) => `Guests: ${g}`,
    areaLine: (a: string) => `Area: ${a}`,
    summary: (lines: string) => `To sum up:\n${lines}\n\nSend the request?`,
    yesSend: 'Yes, send',
    change: 'Change',
    fromWhatsApp: 'Request from WhatsApp',
    event: 'Event',
    theEvent: 'the event',
    bookHere: 'Whenever you like, you can book here 👇',
    bookButton: '📅 Book now',
    nothingToCancel:
      "We couldn't find an upcoming appointment to cancel 🙂 Would you like to book one?",
    whichToCancel: 'Which appointment should we cancel?',
    chooseAppointment: 'Choose',
    confirmCancel: (service: string | null, at: string) =>
      service
        ? `Cancel your ${service} appointment on ${at}?`
        : `Cancel your appointment on ${at}?`,
    yesCancel: 'Yes, cancel',
    keepIt: 'No, keep it',
    kept: 'Great, your appointment stays 👍',
    apptCancelled: 'Your appointment is cancelled ✅\nWant another time? You can book here 👇',
    bookNew: '📅 New booking',
  },
} satisfies Record<Language, unknown>;
type Words = (typeof WORDS)['he'];

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
  language: Language;
  timezone: string;
  openingHours: unknown;
  whatsappBotAutoConfirm: boolean;
  texts: BotTexts;
  showcase: z.output<typeof botShowcaseSchema>;
  /** Storage key of the "meanwhile" video (D-151), sent after its photos. */
  showcaseVideo: string | null;
  flow: BotFlow;
  /** Event requests hold their date until the owner decides. */
  holdDate: boolean;
};
interface Chat {
  business: Business;
  /** This business's WhatsApp (F25). */
  sender: WhatsAppSender;
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
const dayFormat = (w: Words, options: Intl.DateTimeFormatOptions) => (date: string) =>
  new Intl.DateTimeFormat(w.intl, { ...options, timeZone: 'UTC' }).format(noon(date));
const shortDay = (w: Words) => dayFormat(w, { weekday: 'short', day: 'numeric', month: 'numeric' });
const longDay = (w: Words) => dayFormat(w, { weekday: 'long', day: 'numeric', month: 'long' });
const when = (w: Words, date: string, time: string) => w.at(longDay(w)(date), time);
const eventDay = (w: Words, date: string) =>
  dayFormat(w, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })(date);
/** The words for this chat's business. */
const wordsOf = (chat: Chat): Words => WORDS[chat.business.language];
const human = (chat: Chat): WhatsAppChoice => ({ id: 'human', title: wordsOf(chat).human });
const seeOurWork = (chat: Chat): WhatsAppChoice => ({
  id: 'showcase',
  title: wordsOf(chat).seeOurWork,
});

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
  private readonly autoReplier: AutoReplier;

  constructor(
    private readonly prisma: PrismaClient,
    /** Each business's WhatsApp (F25); null when it isn't connected. */
    private readonly senders: (businessId: string) => Promise<WhatsAppSender | null>,
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
    this.autoReplier = new AutoReplier(prisma, log);
  }

  async handle(businessId: string, msg: BotMessage, now = new Date()): Promise<BotOutcome> {
    const number = await this.prisma.whatsAppNumber.findUnique({
      where: { businessId_phone: { businessId, phone: msg.from } },
    });
    // Personal numbers, and customers the owner paused the bot for, never get an automatic reply.
    if (!number || number.status === 'PERSONAL' || number.botPaused) return 'none';
    // D-123: off, a short automatic reply (the default), or the booking bot below.
    const replies = await this.prisma.business.findUnique({
      where: { id: businessId },
      select: {
        id: true,
        name: true,
        whatsappReplyMode: true,
        whatsappAutoReplyText: true,
        whatsappStatuses: true,
        whatsappActiveStatus: true,
        language: true,
      },
    });
    if (!replies) return 'none';
    const mode = modeOf(replies.whatsappReplyMode);
    if (mode === 'off') return 'none';
    if (mode === 'auto_reply') {
      const sender = await this.senders(businessId);
      if (!sender) return 'none';
      const replied = await this.autoReplier.reply(
        replies,
        number,
        await this.linkOf(businessId, number.status, number.phone),
        await this.teamIsTalking(number.id, now),
        now,
        sender,
      );
      // "Meanwhile, a look at our work" follows the automatic reply too (D-149), once a day.
      if (replied) {
        const chat = await this.chatFor(businessId, number, now, { anyMode: true });
        if (chat) await this.showcase(chat, {});
      }
      // The message still reaches the team (bell and pop-up) like any other.
      return 'none';
    }
    const chat = await this.chatFor(businessId, number, now);
    if (!chat) return 'none';
    const choice = msg.replyId && CHOICE.test(msg.replyId) ? msg.replyId : null;
    // For recognising words only (the message itself is kept as written).
    const text = withHebrewLayout(msg.body);

    let session = chat.session;
    if (session && session.expiresAt <= now) {
      await this.prisma.whatsAppBotSession.delete({ where: { id: session.id } });
      session = chat.session = null;
    }
    // D-154: every message gets an answer, also after "talk to the team" — the bot starts again
    // (its greeting keeps the "talk to the team" button). Only a team member writing keeps it quiet.
    if (
      session?.step === 'handoff' &&
      (choice === 'book' || !(await this.teamIsTalking(chat.numberId, now)))
    ) {
      await this.prisma.whatsAppBotSession.delete({ where: { id: session.id } });
      session = chat.session = null;
    }
    // D-153: the customer cancels a booked appointment (its buttons, or "cancel" with no booking
    // in progress) — even after asking for the team, unless a team member is writing.
    if (choice?.startsWith('xcl') || choice?.startsWith('xpick')) {
      return this.onCancelChoice(chat, choice, now);
    }
    if ((!session || session.step === 'handoff') && !choice && CANCEL_TEXT.test(text)) {
      if (await this.teamIsTalking(chat.numberId, now)) return 'none';
      return this.askCancel(chat, now);
    }
    if (session?.step === 'handoff') return 'none';
    if (choice === 'showcase') {
      await this.showcase(chat, { force: true, offerBooking: true });
      return 'handled';
    }
    if (choice === 'book') {
      return chat.business.flow === 'event' ? this.askEventType(chat) : this.start(chat, now);
    }

    if (!session) {
      // D-154: any message starts it (not only booking words or a new number's first message),
      // unless a team member is talking in this chat.
      if (await this.teamIsTalking(chat.numberId, now)) return 'none';
      // "Can I talk to you about…": straight to the team, no questions first.
      if (!choice && HUMAN_TEXT.test(text)) {
        return this.handoff(chat, now, this.text(chat, 'handoff'));
      }
      return this.start(chat, now);
    }

    if (choice === 'human' || (!choice && HUMAN_TEXT.test(text))) {
      return this.handoff(chat, now, this.text(chat, 'handoff'));
    }
    if (choice === 'cancel' || (!choice && CANCEL_TEXT.test(text))) {
      await this.prisma.whatsAppBotSession.delete({ where: { id: session.id } });
      await this.say(
        chat,
        chat.business.flow === 'event' ? wordsOf(chat).cancelledEvent : wordsOf(chat).cancelled,
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
    if (chat.business.flow === 'event') return this.askHowToHelp(chat);
    const services = await this.activeServices(chat.business.id);
    if (services.length === 1) return this.askDay(chat, services[0]!.id, now);
    if (!services.length) return this.askDay(chat, null, now);
    return this.askService(chat);
  }

  private async askService(chat: Chat, prefix = ''): Promise<BotOutcome> {
    const services = await this.activeServices(chat.business.id);
    await this.setSession(chat, { step: 'service', serviceId: null, date: null, time: null });
    const extra = this.hasShowcase(chat) ? [seeOurWork(chat)] : [];
    await this.say(chat, `${prefix}${this.text(chat, 'greeting')}`, {
      button: wordsOf(chat).chooseService,
      rows: [
        ...services.slice(0, MAX_ROWS - extra.length).map((s) => ({
          id: `svc:${s.id}`,
          title: s.name,
          description: [
            wordsOf(chat).minutes(s.durationMin),
            s.price != null ? `₪${s.price}` : null,
          ]
            .filter(Boolean)
            .join(' · '),
        })),
        ...extra,
        human(chat),
      ],
    });
    return 'handled';
  }

  private async pickService(chat: Chat, serviceId: string, now: Date): Promise<BotOutcome> {
    const service = (await this.activeServices(chat.business.id)).find((s) => s.id === serviceId);
    if (!service) return this.askService(chat, wordsOf(chat).serviceGone);
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
    const extra = !chat.session && this.hasShowcase(chat) ? [seeOurWork(chat)] : [];
    const days = dates.filter((d) => free.get(d)!.length > 0).slice(0, MAX_ROWS - extra.length);
    if (!days.length) {
      return this.handoff(chat, now, this.text(chat, 'noTimes'), { offerBooking: false });
    }
    await this.setSession(chat, { step: 'day', serviceId, date: null, time: null });
    const tomorrow = addDaysTo(today, 1);
    const w = wordsOf(chat);
    await this.say(chat, `${prefix}${w.whichDay}`, {
      button: w.chooseDay,
      rows: [
        ...days.map((d) => {
          const n = free.get(d)!.length;
          const label = shortDay(w)(d);
          return {
            id: `day:${d}`,
            title: d === today ? w.today(label) : d === tomorrow ? w.tomorrow(label) : label,
            description: w.freeTimes(n),
          };
        }),
        ...extra,
        human(chat),
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
      return this.askDay(chat, serviceId, now, wordsOf(chat).dayFull);
    }
    await this.setSession(chat, { step: 'time', serviceId, date, time: null });
    const w = wordsOf(chat);
    await this.say(chat, `${prefix}${w.whichTime(longDay(w)(date))}`, {
      button: w.chooseTime,
      rows: [
        ...spread(times, MAX_ROWS).map((t) => ({ id: `time:${t.time}`, title: t.time })),
        { id: 'other_day', title: w.otherDay },
      ],
    });
    return 'handled';
  }

  private async askConfirm(chat: Chat, date: string, time: string): Promise<BotOutcome> {
    const serviceId = chat.session?.serviceId ?? null;
    const service = serviceId ? await this.serviceById(chat.business.id, serviceId) : null;
    await this.setSession(chat, { step: 'confirm', serviceId, date, time });
    const w = wordsOf(chat);
    await this.say(chat, w.confirm(service ? service.name : w.appointment, when(w, date, time)), {
      buttons: [
        { id: 'ok', title: w.yesBook },
        { id: 'other_time', title: w.otherTime },
        { id: 'cancel', title: w.cancel },
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
    const taken = wordsOf(chat).timeTaken;
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

    const at = when(wordsOf(chat), date, time);
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
    if (await this.missedTooOften(chat, now)) return 'handoff';
    const prefix = wordsOf(chat).notUnderstood;
    let out: BotOutcome;
    if (s.step === 'day') out = await this.askDay(chat, s.serviceId, now, prefix);
    else if (s.step === 'time' && s.date) out = await this.askTime(chat, s.date, now, prefix);
    else if (s.step === 'confirm' && s.date && s.time) {
      await this.say(chat, prefix.trim());
      out = await this.askConfirm(chat, s.date, s.time);
    } else out = await this.askService(chat, prefix);
    await this.countMiss(chat);
    return out;
  }

  /**
   * After the second message the bot couldn't understand, a person is better (D-108): the chat
   * goes to the team instead of the same question again.
   */
  private async missedTooOften(chat: Chat, now: Date): Promise<boolean> {
    const misses = (chat.session?.data as { misses?: number } | null)?.misses ?? 0;
    if (misses + 1 < MAX_MISSES) return false;
    await this.handoff(chat, now, this.text(chat, 'handoff'));
    return true;
  }

  private async countMiss(chat: Chat) {
    if (!chat.session) return;
    const data = (chat.session.data ?? {}) as Record<string, unknown>;
    chat.session = await this.prisma.whatsAppBotSession.update({
      where: { id: chat.session.id },
      data: { data: { ...data, misses: ((data.misses as number) ?? 0) + 1 } },
    });
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
    if (choice === 'ev_start') return this.askEventType(chat);
    if (choice?.startsWith('evt:')) return this.pickEventType(chat, choice.slice(4));
    if (choice === 'ev_edit') return this.askEventType(chat);
    if (choice === 'other_date') return this.askEventDate(chat);
    if (choice?.startsWith('part:') && s.date) return this.pickPart(chat, choice.slice(5) as Part);
    if (choice?.startsWith('guests:')) {
      const guests = wordsOf(chat).guests[Number(choice.slice(7))];
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
      await this.say(chat, wordsOf(chat).whichAreaEvent);
      return 'handled';
    }
    return this.repeatEvent(chat);
  }

  /**
   * The first reply to an event business's customer (D-108): how can we help — check a date or a
   * personal chat (and the showcase, when set) — before asking anything.
   */
  private async askHowToHelp(chat: Chat, prefix = ''): Promise<BotOutcome> {
    await this.setSession(chat, { step: 'ev_intro', serviceId: null, date: null, time: null });
    await this.say(chat, `${prefix}${this.text(chat, 'greeting')}`, {
      buttons: [
        { id: 'ev_start', title: wordsOf(chat).checkDate },
        { id: 'human', title: wordsOf(chat).personalChat },
        ...(this.hasShowcase(chat) ? [seeOurWork(chat)] : []),
      ],
    });
    return 'handled';
  }

  private async askEventType(chat: Chat, prefix = ''): Promise<BotOutcome> {
    const services = await this.activeServices(chat.business.id);
    const extra = this.hasShowcase(chat) ? [seeOurWork(chat)] : [];
    const options: WhatsAppChoice[] = services.length
      ? services.map((sv) => ({
          id: `evt:svc:${sv.id}`,
          title: sv.name,
          ...(sv.price != null ? { description: wordsOf(chat).from(sv.price) } : {}),
        }))
      : eventTypesFor(chat.business.industry, chat.business.language).map((t, i) => ({
          id: `evt:t${i}`,
          title: t,
        }));
    await this.setSession(chat, {
      step: 'ev_type',
      serviceId: null,
      date: null,
      time: null,
      data: {},
    });
    const question = eventTypeQuestionFor(chat.business.industry, chat.business.language);
    await this.say(chat, `${prefix}${question}`, {
      button: wordsOf(chat).chooseType,
      rows: [...options.slice(0, MAX_ROWS - extra.length), ...extra, human(chat)],
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
      type = eventTypesFor(chat.business.industry, chat.business.language)[Number(id.slice(1))];
    }
    if (!type) return this.askEventType(chat, wordsOf(chat).optionGone);
    await this.setSession(chat, {
      step: 'ev_date',
      serviceId,
      date: null,
      time: null,
      data: { type },
    });
    return this.askEventDate(chat, wordsOf(chat).great(type));
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
    await this.say(chat, `${prefix}${wordsOf(chat).whichDate}`, {
      buttons: [human(chat)],
    });
    return 'handled';
  }

  private async onEventDate(chat: Chat, body: string, now: Date): Promise<BotOutcome> {
    const date = parseEventDate(body, todayIn(chat.business.timezone, now));
    if (!date) {
      await this.say(chat, wordsOf(chat).badDate);
      return 'handled';
    }
    if (await this.dateTaken(chat, date)) {
      await this.say(chat, this.text(chat, 'dateTaken'), {
        buttons: [{ id: 'other_date', title: wordsOf(chat).otherDate }, human(chat)],
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
    await this.say(chat, wordsOf(chat).dateFree(eventDay(wordsOf(chat), date)), {
      buttons: (Object.keys(PARTS) as Part[]).map((k) => ({
        id: `part:${k}`,
        title: wordsOf(chat).parts[k],
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
    const w = wordsOf(chat);
    await this.say(chat, w.howManyGuests, {
      button: w.guestsButton,
      rows: w.guests.map((g, i) => ({ id: `guests:${i}`, title: g })),
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
    await this.say(chat, wordsOf(chat).whichArea);
    return 'handled';
  }

  private eventSummary(w: Words, date: string, d: EventData): string[] {
    return [
      d.type ?? '',
      `${eventDay(w, date)}${d.part && d.part !== 'unknown' ? `, ${w.parts[d.part]}` : ''}`,
      ...(d.guests ? [w.guestsLine(d.guests)] : []),
      ...(d.area ? [w.areaLine(d.area)] : []),
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
    const w = wordsOf(chat);
    const lines = this.eventSummary(w, date, data).map((l) => `• ${l}`);
    await this.say(chat, w.summary(lines.join('\n')), {
      buttons: [
        { id: 'ev_send', title: w.yesSend },
        { id: 'ev_edit', title: w.change },
        { id: 'cancel', title: w.cancel },
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
          // Unconfirmed requests block the date only when the owner chose to hold dates.
          status: { in: chat.business.holdDate ? BLOCKING_STATUSES : ['CONFIRMED'] },
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
        buttons: [{ id: 'other_date', title: wordsOf(chat).otherDate }, human(chat)],
      });
      return 'handled';
    }
    const part = PARTS[data.part ?? 'unknown'];
    const w = wordsOf(chat);
    const booked = await this.prisma.$transaction(async (tx) => {
      const customer = await this.ensureCustomer(tx, business.id, chat.numberId);
      await this.appointments.requestEventFromWhatsApp(tx, {
        businessId: business.id,
        ...customer,
        serviceId: chat.session?.serviceId ?? null,
        startsAt: zonedTimeToUtc(date, part.from, business.timezone),
        endsAt: zonedTimeToUtc(date, part.to, business.timezone),
        notes: [w.fromWhatsApp, ...this.eventSummary(w, date, data)].join(' · '),
        eventType: data.type ?? w.event,
      });
      await tx.whatsAppBotSession.deleteMany({ where: { numberId: chat.numberId } });
      return customer;
    });
    chat.link = booked;
    chat.session = null;
    await this.say(
      chat,
      this.text(chat, 'eventReceived', {
        service: data.type ?? w.theEvent,
        when: eventDay(w, date),
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
        when: `${data.type ?? w.event} · ${eventDay(w, date)}`,
        pending: true,
      },
      to: { roles: MANAGERS },
    });
    return 'handled';
  }

  /** Not one of the choices: ask the current question of the event request again. */
  private async repeatEvent(chat: Chat): Promise<BotOutcome> {
    const s = chat.session!;
    if (await this.missedTooOften(chat, chat.now)) return 'handoff';
    const prefix = wordsOf(chat).notUnderstoodEvent;
    const data = this.eventData(chat);
    let out: BotOutcome;
    if (s.step === 'ev_intro') out = await this.askHowToHelp(chat, prefix);
    else if (s.step === 'ev_part' && s.date) {
      await this.say(chat, prefix.trim());
      chat.session = { ...s, step: 'ev_date' };
      out = await this.onEventDate(chat, s.date.split('-').reverse().join('.'), chat.now);
    } else if (s.step === 'ev_guests') out = await this.pickPart(chat, data.part ?? 'unknown');
    else if (s.step === 'ev_confirm') out = await this.askEventConfirm(chat, data);
    else out = await this.askEventType(chat, prefix);
    await this.countMiss(chat);
    return out;
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
    const text = fillBotText(
      sc.text ?? showcaseDefaultText(chat.business.industry, chat.business.language),
      {
        business: chat.business.name,
        service: wordsOf(chat).appointment,
        when: '',
      },
    );
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
    if (chat.business.showcaseVideo) {
      const video = await this.storage.get(chat.business.showcaseVideo).catch(() => null);
      if (video) await this.sayVideo(chat, video);
    }
    if (offerBooking) {
      await this.say(chat, wordsOf(chat).bookHere, {
        buttons: [{ id: 'book', title: wordsOf(chat).bookButton }],
      });
    }
    chat.showcaseAt = chat.now;
    await this.prisma.whatsAppNumber.update({
      where: { id: chat.numberId },
      data: { botShowcaseAt: chat.now },
    });
    return true;
  }

  // ---------------------------------------------------------------- cancelling (D-153)

  /** The customer's upcoming bookings, soonest first. */
  private async upcoming(chat: Chat, now: Date) {
    if (!chat.link.contactId) return [];
    return this.prisma.appointment.findMany({
      where: {
        businessId: chat.business.id,
        contactId: chat.link.contactId,
        status: { in: ['REQUESTED', 'CONFIRMED'] },
        startsAt: { gt: now },
      },
      orderBy: { startsAt: 'asc' },
      take: MAX_ROWS,
      select: { id: true, startsAt: true, service: { select: { name: true } } },
    });
  }

  /** "Thursday, 12 November at 13:00" in the business's time zone and language. */
  private at(chat: Chat, d: Date) {
    const tz = chat.business.timezone;
    const date = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
    const time = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(d);
    return when(wordsOf(chat), date, time);
  }

  private async askCancel(chat: Chat, now: Date): Promise<BotOutcome> {
    const w = wordsOf(chat);
    const list = await this.upcoming(chat, now);
    if (!list.length) {
      await this.say(chat, w.nothingToCancel, {
        buttons: [{ id: 'book', title: w.bookButton }, human(chat)],
      });
      return 'handled';
    }
    if (list.length === 1) return this.confirmCancel(chat, list[0]!);
    await this.say(chat, w.whichToCancel, {
      button: w.chooseAppointment,
      rows: list.map((a) => ({
        id: `xpick:${a.id}`,
        title: a.service?.name ?? w.appointment,
        description: this.at(chat, a.startsAt),
      })),
    });
    return 'handled';
  }

  private async confirmCancel(
    chat: Chat,
    a: { id: string; startsAt: Date; service: { name: string } | null },
  ): Promise<BotOutcome> {
    const w = wordsOf(chat);
    await this.say(chat, w.confirmCancel(a.service?.name ?? null, this.at(chat, a.startsAt)), {
      buttons: [
        { id: `xcl:${a.id}`, title: w.yesCancel },
        { id: 'xcl_no', title: w.keepIt },
      ],
    });
    return 'handled';
  }

  private async onCancelChoice(chat: Chat, choice: string, now: Date): Promise<BotOutcome> {
    const w = wordsOf(chat);
    if (choice === 'xcl_no') {
      await this.say(chat, w.kept);
      return 'handled';
    }
    const id = choice.slice(choice.indexOf(':') + 1);
    const appt = (await this.upcoming(chat, now)).find((a) => a.id === id);
    // Already cancelled or past: show what's left to cancel.
    if (!appt) return this.askCancel(chat, now);
    if (choice.startsWith('xpick:')) return this.confirmCancel(chat, appt);

    const done = await this.prisma.$transaction((tx) =>
      this.appointments.cancelFromWhatsApp(tx, {
        businessId: chat.business.id,
        appointmentId: appt.id,
        contactId: chat.link.contactId!,
      }),
    );
    if (!done) return this.askCancel(chat, now);
    await this.say(chat, w.apptCancelled, { buttons: [{ id: 'book', title: w.bookNew }] });
    const contact = await this.prisma.contact.findUnique({
      where: { id: chat.link.contactId! },
      select: { name: true },
    });
    await notifySafe(this.prisma, this.log, {
      businessId: chat.business.id,
      type: 'appointment.cancelled',
      data: {
        leadId: done.leadId,
        name: contact?.name ?? chat.phone,
        when: `${appt.service?.name ?? w.appointment} · ${this.at(chat, appt.startsAt)}`,
      },
      to: { roles: MANAGERS, userIds: [done.staffId ?? undefined] },
    });
    return 'handled';
  }

  // ---------------------------------------------------------------- helpers

  /** Everything the bot needs about this business and chat; null when the bot is off. */
  private async chatFor(
    businessId: string,
    number: { id: string; phone: string; status: string; botShowcaseAt: Date | null },
    now: Date,
    /** The showcase after an automatic reply needs the business even with the bot off. */
    { anyMode = false }: { anyMode?: boolean } = {},
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
        whatsappBotHoldDate: true,
        language: true,
      },
    });
    if (!business || (!business.whatsappBotEnabled && !anyMode)) return null;
    const sender = await this.senders(businessId);
    if (!sender) return null;
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
        language: languageOf(business.language),
        showcaseVideo: showcaseVideoOf(business.whatsappBotShowcase)?.key ?? null,
        holdDate: business.whatsappBotHoldDate,
        flow,
        texts: texts.success ? texts.data : {},
        showcase: showcase.success
          ? showcase.data
          : { enabled: false, text: undefined, link: null, assetIds: [] },
      },
      sender,
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
      chat.business.texts[key] ??
        botDefaultTextsFor(chat.business.industry, chat.business.language)[key],
      {
        business: chat.business.name,
        service: values.service ?? wordsOf(chat).appointment,
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
        ? await chat.sender.sendText(chat.phone, body, opts)
        : 'buttons' in choices
          ? await chat.sender.sendButtons(chat.phone, body, choices.buttons)
          : await chat.sender.sendList(chat.phone, body, choices.button, choices.rows));
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

  /** Sends and stores a video (shown in LeadFlow as "[וידאו]"). */
  private async sayVideo(chat: Chat, mp4: Buffer) {
    let id: string;
    try {
      ({ id } = await chat.sender.sendVideo(chat.phone, mp4));
    } catch (err) {
      this.log.error({ errName: (err as Error)?.name }, 'whatsapp showcase video failed');
      return;
    }
    await this.prisma.whatsAppMessage.create({
      data: {
        businessId: chat.business.id,
        numberId: chat.numberId,
        contactId: chat.link.contactId,
        leadId: chat.link.leadId,
        direction: 'OUT',
        waMessageId: id,
        body: '[וידאו]',
        status: 'sent',
      },
    });
  }

  /** Sends and stores a photo (shown in LeadFlow as "[תמונה]"). */
  private async sayImage(chat: Chat, jpeg: Buffer) {
    const { id } = await chat.sender.sendImage(chat.phone, jpeg);
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
