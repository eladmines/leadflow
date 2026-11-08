import { z } from 'zod';
import type { Language } from './business';
import {
  AUTO_REPLY_DEFAULT_EN,
  BOT_DEFAULT_TEXTS_EN,
  eventTypeQuestionEn,
  eventTypesEn,
  INDUSTRY_TEXTS_EN,
  SHOWCASE_DEFAULT_EN,
  SHOWCASE_TEXTS_EN,
  STATUS_PRESETS_EN,
} from './whatsapp-en';

/**
 * F12 POC — WhatsApp via Meta's Cloud API (D-091, Proposed). An incoming message becomes a lead
 * (source `whatsapp`) or joins the contact's open lead; the team reads the conversation on the lead
 * and replies while WhatsApp's 24-hour customer-service window is open.
 */

/** Free-form replies are allowed for this long after the customer's last message (Meta rule). */
export const WHATSAPP_WINDOW_MS = 24 * 60 * 60 * 1000;
export const WHATSAPP_TEXT_MAX = 1000;

export const whatsappMessages = {
  untilPast: 'הזמן שבחרתם כבר עבר',
  textRequired: 'יש לכתוב הודעה',
  textTooLong: `ההודעה ארוכה מדי (עד ${WHATSAPP_TEXT_MAX.toLocaleString('en-US')} תווים)`,
  notConnected: 'WhatsApp עדיין לא מחובר לעסק הזה',
  noPhone: 'לליד הזה אין מספר טלפון',
  windowClosed:
    'אפשר לענות בוואטסאפ רק עד 24 שעות אחרי ההודעה האחרונה של הלקוח. כדי לפנות מחדש, התקשרו אליו.',
  sendFailed: 'ההודעה לא נשלחה. נסו שוב בעוד רגע',
  alreadyCustomer: 'המספר כבר משויך ללקוח במערכת. כדי להסיר אותו, מחקו את הליד.',
  notPersonal: 'אפשר לבטל רק סימון של מספר פרטי',
  messengerNotConnected: 'פייסבוק עדיין לא מחובר לעסק הזה',
  messengerWindowClosed: 'אפשר לענות בפייסבוק רק עד 24 שעות אחרי ההודעה האחרונה של הלקוח.',
} as const;

/** Where a conversation happens (F23, D-157): WhatsApp or the business's Facebook Page. */
export const CHANNELS = ['whatsapp', 'messenger'] as const;
export const channelSchema = z.enum(CHANNELS);
export type Channel = z.infer<typeof channelSchema>;
export const channelLabels: Record<Channel, string> = {
  whatsapp: 'WhatsApp',
  messenger: 'פייסבוק',
};

export const WHATSAPP_DIRECTIONS = ['IN', 'OUT'] as const;
/** Delivery status from Meta for outgoing messages; incoming ones are `received`. */
export const WHATSAPP_STATUSES = ['received', 'sent', 'delivered', 'read', 'failed'] as const;

export const whatsappStatusLabels: Record<(typeof WHATSAPP_STATUSES)[number], string> = {
  received: 'התקבלה',
  sent: 'נשלחה',
  delivered: 'נמסרה',
  read: 'נקראה',
  failed: 'לא נמסרה',
};

export const whatsappMessageSchema = z.object({
  id: z.string().uuid(),
  direction: z.enum(WHATSAPP_DIRECTIONS),
  body: z.string(),
  status: z.enum(WHATSAPP_STATUSES),
  /** Team member who sent an outgoing message. */
  sender: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
  createdAt: z.string().datetime(),
  /** WhatsApp unless it came through Facebook Messenger (F23). */
  channel: channelSchema.optional(),
});
export type WhatsAppMessage = z.infer<typeof whatsappMessageSchema>;

export const whatsappThreadResponseSchema = z.object({
  /** False when no WhatsApp number is connected to this business. */
  connected: z.boolean(),
  /** Oldest first. */
  messages: z.array(whatsappMessageSchema),
  /** End of the 24-hour reply window; null when the customer never wrote or it has closed. */
  replyUntil: z.string().datetime().nullable(),
  /** The booking bot is paused for this customer (D-108). */
  botPaused: z.boolean(),
  /** Where a reply goes: the channel of the customer's last message (F23). */
  channel: channelSchema.optional(),
});
export type WhatsAppThreadResponse = z.infer<typeof whatsappThreadResponseSchema>;

export const sendWhatsAppRequestSchema = z.object({
  text: z
    .string({ required_error: whatsappMessages.textRequired })
    .trim()
    .min(1, whatsappMessages.textRequired)
    .max(WHATSAPP_TEXT_MAX, whatsappMessages.textTooLong),
});
export type SendWhatsAppRequest = z.infer<typeof sendWhatsAppRequestSchema>;

/** Pause or resume the booking bot for one customer (D-108). */
export const pauseBotRequestSchema = z.object({ paused: z.boolean() });
export const sendWhatsAppResponseSchema = z.object({ message: whatsappMessageSchema });
export type SendWhatsAppResponse = z.infer<typeof sendWhatsAppResponseSchema>;

// ---------------------------------------------------------------------------
// Number classification (D-092)
// ---------------------------------------------------------------------------

/**
 * Known customers (an existing contact) are business numbers automatically; new numbers wait in the
 * inbox until the owner marks them business (→ contact + lead) or personal (messages deleted, number
 * ignored from then on). The choice is remembered.
 */
export const WHATSAPP_NUMBER_STATUSES = ['UNCLASSIFIED', 'BUSINESS', 'PERSONAL'] as const;
export const inboxNumberSchema = z.object({
  id: z.string().uuid(),
  /** WhatsApp: E.164. Messenger: an internal id, never shown. */
  phone: z.string(),
  channel: channelSchema.optional(),
  /** WhatsApp profile name, if the sender has one. */
  profileName: z.string().nullable(),
  /** Oldest first (up to the latest 20). */
  messages: z.array(whatsappMessageSchema),
  lastMessageAt: z.string().datetime(),
});
export type InboxNumber = z.infer<typeof inboxNumberSchema>;

export const whatsappInboxResponseSchema = z.object({
  connected: z.boolean(),
  /** Unclassified numbers, most recent conversation first. */
  numbers: z.array(inboxNumberSchema),
});
export type WhatsAppInboxResponse = z.infer<typeof whatsappInboxResponseSchema>;

export const personalNumbersResponseSchema = z.object({
  numbers: z.array(
    z.object({
      id: z.string().uuid(),
      phone: z.string(),
      channel: channelSchema.optional(),
      /** Messenger: the sender's Facebook name (the id isn't shown). */
      name: z.string().nullable().optional(),
      classifiedAt: z.string().datetime().nullable(),
    }),
  ),
});
export type PersonalNumbersResponse = z.infer<typeof personalNumbersResponseSchema>;

export const classifyNumberRequestSchema = z.object({ as: z.enum(['BUSINESS', 'PERSONAL']) });
export type ClassifyNumberRequest = z.infer<typeof classifyNumberRequestSchema>;

export const classifyNumberResponseSchema = z.object({
  status: z.enum(WHATSAPP_NUMBER_STATUSES),
  /** The lead the conversation now belongs to (business only). */
  leadId: z.string().uuid().nullable(),
});
export type ClassifyNumberResponse = z.infer<typeof classifyNumberResponseSchema>;

// ---------------------------------------------------------------------------
// Booking bot (D-102)
// ---------------------------------------------------------------------------

/**
 * A button bot on the business's WhatsApp number: a customer who asks for an appointment (or writes
 * for the first time) picks a service, a day and a free time from WhatsApp lists, and the
 * appointment is booked. Off by default; never answers personal numbers or a chat the team took over.
 */
/** Bot messages the business can rewrite (buttons, list labels and the steps stay fixed). */
export const BOT_TEXT_KEYS = [
  'greeting',
  'confirmed',
  'pending',
  'handoff',
  'noTimes',
  'eventReceived',
  'dateTaken',
] as const;
export type BotTextKey = (typeof BOT_TEXT_KEYS)[number];

/**
 * How customers book (D-107): `appointment` = a free time slot (service → day → time), `event` =
 * a request for a date (event type → date → part of day → guests → area), confirmed by the team,
 * typically with a quote. The default follows the industry; the business can switch.
 */
export const BOT_FLOWS = ['appointment', 'event'] as const;
export type BotFlow = (typeof BOT_FLOWS)[number];
export const botFlowLabels: Record<BotFlow, string> = {
  appointment: 'תורים בשעות פנויות',
  event: 'בקשות לאירוע (תאריך, אורחים, אזור)',
};
const EVENT_INDUSTRIES = ['events', 'catering', 'photo'];
export const botFlowFor = (industry: string): BotFlow =>
  EVENT_INDUSTRIES.includes(industry) ? 'event' : 'appointment';

/** The messages each flow sends. */
export const botTextKeysFor = (flow: BotFlow): readonly BotTextKey[] =>
  flow === 'event'
    ? ['greeting', 'eventReceived', 'dateTaken', 'handoff']
    : ['greeting', 'confirmed', 'pending', 'handoff', 'noTimes'];

/** Event types offered when the business has no services of its own. */
export function eventTypesFor(industry: string, lang: Language = 'he'): string[] {
  if (lang === 'en') return eventTypesEn(industry);
  if (industry === 'catering') {
    return ['חתונה', 'בר/בת מצווה', 'אירוע חברה', 'ארוחה פרטית', 'שבת / חג', 'אחר'];
  }
  if (industry === 'photo') {
    return ['חתונה', 'צילומי משפחה', 'הריון וניובורן', 'אירוע חברה', 'תדמית ומוצר', 'אחר'];
  }
  return ['חתונה', 'בר/בת מצווה', 'יום הולדת', 'אירוע חברה', 'מסיבה פרטית', 'אחר'];
}
/**
 * Event businesses (D-108): the first reply asks how to help — check a date, or a personal chat —
 * before any question; then this asks for the event type.
 */
export const eventTypeQuestionFor = (industry: string, lang: Language = 'he') =>
  lang === 'en'
    ? eventTypeQuestionEn(industry)
    : industry === 'photo'
      ? 'מה מצלמים? בחרו:'
      : 'איזה אירוע אתם מתכננים? בחרו:';

/** Photo shoots don't ask for the number of guests. */
export const asksGuests = (industry: string) => industry !== 'photo';
export const BOT_TEXT_MAX = 600;
/** Filled in when the message is sent: business name, chosen service, chosen date and time. */
export const BOT_PLACEHOLDERS = ['{business}', '{service}', '{time}'] as const;
export const botPlaceholderLabels: Record<(typeof BOT_PLACEHOLDERS)[number], string> = {
  '{business}': 'שם העסק',
  '{service}': 'שירות',
  '{time}': 'מועד התור',
};

export const botTextLabels: Record<BotTextKey, string> = {
  greeting: 'הודעת פתיחה',
  confirmed: 'אישור תור',
  pending: 'בקשה שממתינה לאישור',
  handoff: 'מעבר לצוות',
  noTimes: 'אין זמנים פנויים',
  eventReceived: 'בקשה לאירוע התקבלה',
  dateTaken: 'התאריך תפוס',
};

export const botDefaultTexts: Record<BotTextKey, string> = {
  greeting: 'שלום! כאן {business} 👋\nרוצים לקבוע תור? בחרו שירות:',
  confirmed:
    'מעולה! קבענו לכם {service} ל{time} ✅\nנתראה ב{business}! לשינוי או ביטול, פשוט כתבו לנו כאן.',
  pending: 'קיבלנו את הבקשה ל{service} ב{time} 🙏\nנאשר לכם כאן בהקדם.',
  handoff: 'בסדר! העברנו את השיחה לצוות, נחזור אליכם כאן בהקדם 🙂',
  noTimes:
    'מצטערים, אין כרגע זמנים פנויים בשבועיים הקרובים. העברנו את הפנייה לצוות ונחזור אליכם כאן 🙏',
  eventReceived: 'תודה! קיבלנו את הפרטים ל{service} ב{time} 🙏\nנחזור אליכם בהקדם עם הצעה מסודרת.',
  dateTaken: 'התאריך הזה כבר תפוס אצלנו 😕 רוצים לבדוק תאריך אחר?',
};

/** Per industry, the messages that differ from the general ones (D-107). */
const industryTexts: Record<string, Partial<Record<BotTextKey, string>>> = {
  studio: {
    greeting: 'היי! כאן {business} 💪\nרוצים לקבוע שיעור או אימון? בחרו:',
    confirmed:
      'מעולה! שריינו לכם {service} ל{time} ✅\nנתראה ב{business}! לשינוי או ביטול, כתבו לנו כאן.',
    pending: 'קיבלנו את הבקשה ל{service} ב{time} 🙏\nנאשר לכם את המקום בהקדם.',
  },
  therapy: {
    greeting: 'שלום, כאן {business}.\nרוצים לקבוע פגישה? בחרו את סוג הפגישה:',
    confirmed: 'הפגישה נקבעה: {service}, {time} ✅\nלשינוי או ביטול אפשר לכתוב כאן.',
    pending: 'קיבלנו את הבקשה לפגישה ב{time} 🙏\nאאשר בהקדם.',
    handoff: 'בסדר, העברתי את השיחה. אחזור אליכם כאן בהקדם.',
  },
  tutoring: {
    greeting: 'היי! כאן {business} 📚\nרוצים לקבוע שיעור? בחרו:',
    confirmed: 'השיעור נקבע: {service}, {time} ✅\nלשינוי או ביטול, כתבו לנו כאן.',
    pending: 'קיבלנו את הבקשה לשיעור ב{time} 🙏\nנאשר בהקדם.',
  },
  trades: {
    greeting: 'היי! כאן {business} 🛠️\nרוצים לתאם ביקור? בחרו את סוג העבודה:',
    confirmed: 'מעולה! תיאמנו ביקור ל{time} ({service}) ✅\nלשינוי או ביטול, כתבו לנו כאן.',
    pending: 'קיבלנו את הבקשה לביקור ב{time} 🙏\nנאשר לכם בהקדם.',
  },
  garage: {
    greeting: 'היי! כאן {business} 🔧\nרוצים לקבוע תור למוסך? בחרו טיפול:',
  },
  events: {
    greeting: 'היי! כאן {business} 🎧\nאיך אפשר לעזור?',
  },
  catering: {
    greeting: 'היי! כאן {business} 🍽️\nאיך אפשר לעזור?',
    eventReceived:
      'תודה! קיבלנו את הפרטים ל{service} ב{time} 🙏\nנחזור אליכם בהקדם עם הצעה ותפריט מותאם.',
  },
  photo: {
    greeting: 'היי! כאן {business} 📸\nאיך אפשר לעזור?',
    eventReceived:
      'תודה! קיבלנו את הפרטים לצילום ({service}) ב{time} 🙏\nנחזור אליכם בהקדם עם הצעה.',
  },
};

/** The default messages for a business in this industry, in its language (D-143). */
export const botDefaultTextsFor = (
  industry: string,
  lang: Language = 'he',
): Record<BotTextKey, string> =>
  lang === 'en'
    ? { ...BOT_DEFAULT_TEXTS_EN, ...INDUSTRY_TEXTS_EN[industry] }
    : { ...botDefaultTexts, ...industryTexts[industry] };

export const botTextMessages = {
  tooLong: `ההודעה ארוכה מדי (עד ${BOT_TEXT_MAX} תווים)`,
  unknownPlaceholder:
    'אי אפשר להשתמש בסוגריים מסולסלים { }. כדי להוסיף פרטים, השתמשו בכפתורי ההוספה.',
} as const;

/** A bot message with its placeholders filled in. */
export function fillBotText(
  template: string,
  values: { business: string; service: string; when: string },
): string {
  return template
    .replaceAll('{business}', values.business)
    .replaceAll('{service}', values.service)
    .replaceAll('{time}', values.when);
}

/** A custom message; empty means "use the default". */
const botTextSchema = z
  .string()
  .trim()
  .max(BOT_TEXT_MAX, botTextMessages.tooLong)
  .refine(
    (t) =>
      (t.match(/\{[^}]*\}/g) ?? []).every((p) =>
        (BOT_PLACEHOLDERS as readonly string[]).includes(p),
      ),
    botTextMessages.unknownPlaceholder,
  )
  .nullable()
  .optional()
  .transform((t) => t || undefined);

export const botTextsSchema = z.object(
  Object.fromEntries(BOT_TEXT_KEYS.map((k) => [k, botTextSchema])) as Record<
    BotTextKey,
    typeof botTextSchema
  >,
);
export type BotTexts = Partial<Record<BotTextKey, string>>;

/**
 * "In the meantime, take a look" (D-106): when a customer doesn't book — cancels, asks for the
 * team, finds no free time or stops answering — the bot sends the business's showcase (a message,
 * a link such as Instagram or a video, and up to 3 photos from the media library), at most once a
 * day per customer, then offers to book. Also on request from "📸 See our work" in the bot's list.
 */
export const SHOWCASE_MAX_IMAGES = 3;
export const showcaseMessages = {
  linkInvalid: 'יש להזין קישור מלא שמתחיל ב־https://',
  tooManyImages: `אפשר לבחור עד ${SHOWCASE_MAX_IMAGES} תמונות`,
  imageMissing: 'אחת התמונות כבר לא קיימת בספריית התמונות. בחרו תמונה אחרת.',
  videoInvalid: 'אפשר להעלות רק סרטון MP4',
  videoTooLarge: 'הסרטון גדול מ־16MB. נסו סרטון קצר יותר',
} as const;

const industryShowcase: Record<string, string> = {
  beauty: 'בינתיים, הנה הצצה לעבודות שלנו ✂️',
  studio: 'בינתיים, הנה הצצה לסטודיו ולשיעורים שלנו 💪',
  garage: 'בינתיים, הנה קצת עלינו ועל העבודה שלנו 🔧',
  trades: 'בינתיים, הנה כמה מהעבודות שעשינו לאחרונה 🛠️',
  events: 'בינתיים, הנה הצצה לאירועים שלנו 🎧',
  catering: 'בינתיים, הנה כמה מהמנות והאירועים שלנו 🍽️',
  photo: 'בינתיים, הנה כמה מהצילומים שלנו 📸',
  therapy: 'בינתיים, הנה קצת עליי ועל הדרך שלי 🌿',
  tutoring: 'בינתיים, הנה קצת על השיעורים שלנו 📚',
};
/** The showcase message until the business writes its own. */
export const showcaseDefaultText = (industry: string, lang: Language = 'he') =>
  lang === 'en'
    ? (SHOWCASE_TEXTS_EN[industry] ?? SHOWCASE_DEFAULT_EN)
    : (industryShowcase[industry] ?? 'בינתיים, הנה הצצה למה שאנחנו עושים ✨');

export const botShowcaseSchema = z.object({
  enabled: z.boolean(),
  /** Empty = the default for the business's industry. */
  text: botTextSchema,
  link: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z
      .string()
      .trim()
      .max(500, showcaseMessages.linkInvalid)
      .regex(/^https:\/\/[^\s]+\.[^\s]+$/, showcaseMessages.linkInvalid)
      .nullable()
      .default(null),
  ),
  assetIds: z
    .array(z.string().uuid())
    .max(SHOWCASE_MAX_IMAGES, showcaseMessages.tooManyImages)
    .default([]),
});
// ---------------------------------------------------------------------------
// Automatic replies and statuses (D-123)
// ---------------------------------------------------------------------------

/**
 * What the business number does with a customer's message: nothing, a short automatic reply
 * (the default — the business's status message when one is on), or the booking bot.
 */
export const REPLY_MODES = ['off', 'auto_reply', 'booking'] as const;
export type ReplyMode = (typeof REPLY_MODES)[number];
export const replyModeLabels: Record<ReplyMode, string> = {
  off: 'כבוי — בלי מענה אוטומטי',
  auto_reply: 'מענה אוטומטי',
  booking: 'קביעת תורים אוטומטית',
};

/** The general reply, until the business writes its own (in the business's language, D-143). */
export const AUTO_REPLY_DEFAULT =
  'היי! תודה שכתבת ל{business} 🙏 קיבלנו את ההודעה ונחזור אליך בהקדם.';
export const autoReplyDefaultFor = (lang: Language = 'he') =>
  lang === 'en' ? AUTO_REPLY_DEFAULT_EN : AUTO_REPLY_DEFAULT;

/** Ready-made statuses (D-123); the business edits their text and adds its own. */
export const STATUS_PRESETS = [
  {
    id: 'event',
    label: 'באירוע',
    text: 'היי! כרגע אני באירוע 🎉 אחזור אליך בהקדם. בינתיים, הנה טעימה ממה שקורה כאן:',
  },
  { id: 'meeting', label: 'בפגישה', text: 'היי! אני בפגישה כרגע, אחזור אליך תוך זמן קצר 🙏' },
  {
    id: 'vacation',
    label: 'בחופשה',
    text: 'היי! אנחנו בחופשה קצרה 🌴 נחזור לענות בקרוב. תודה על הסבלנות!',
  },
  { id: 'closed', label: 'סגור עכשיו', text: 'היי! אנחנו סגורים כרגע 🌙 נחזור אליך כשנפתח.' },
] as const;
export const statusPresetsFor = (lang: Language = 'he') =>
  lang === 'en' ? STATUS_PRESETS_EN : STATUS_PRESETS;

/** The "meanwhile" video (D-151): one MP4, WhatsApp's limit. */
export const SHOWCASE_VIDEO_MAX_BYTES = 16 * 1024 * 1024;
export const MAX_STATUSES = 12;

export const statusMessages = {
  labelRequired: 'יש לתת שם לסטטוס',
  labelTooLong: 'שם הסטטוס ארוך מדי (עד 40 תווים)',
  textRequired: 'יש לכתוב את ההודעה',
  textTooLong: 'ההודעה ארוכה מדי (עד 1000 תווים)',
} as const;

export const replyStatusSchema = z.object({
  /** Preset ids (event, meeting…) or `c-…` for the business's own. */
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  label: z
    .string({ required_error: statusMessages.labelRequired })
    .trim()
    .min(1, statusMessages.labelRequired)
    .max(40, statusMessages.labelTooLong),
  text: z
    .string({ required_error: statusMessages.textRequired })
    .trim()
    .min(1, statusMessages.textRequired)
    .max(1000, statusMessages.textTooLong),
});
export type ReplyStatus = z.infer<typeof replyStatusSchema>;

/** PUT …/whatsapp/status — the status on now (null = none), optionally until a time. */
export const setStatusRequestSchema = z.object({
  id: z
    .string()
    .regex(/^[a-z0-9-]{1,40}$/)
    .nullable(),
  until: z.string().datetime().nullable().default(null),
});
export type SetStatusRequest = z.input<typeof setStatusRequestSchema>;

export const whatsappBotSettingsSchema = z.object({
  /** Missing (older clients): follows `enabled` (on = booking). */
  mode: z.enum(REPLY_MODES).optional(),
  /** The general automatic reply; null = AUTO_REPLY_DEFAULT. */
  autoReplyText: z.string().trim().max(1000, statusMessages.textTooLong).nullable().default(null),
  /** The statuses to keep (missing = unchanged). Videos stay with their status id. */
  statuses: z.array(replyStatusSchema).max(MAX_STATUSES).optional(),
  enabled: z.boolean(),
  /** true: booked as confirmed; false: booked as "waiting for approval" (holds the time). */
  autoConfirm: z.boolean(),
  /** The business's own wording; missing keys use the industry's defaults. */
  texts: botTextsSchema.default({}),
  showcase: botShowcaseSchema.default({ enabled: false }),
  /** Null = the industry's flow. */
  flow: z.enum(BOT_FLOWS).nullable().default(null),
  /** Event requests hold their date until the owner decides (off: only confirmed events do). */
  holdDate: z.boolean().default(false),
});
export type WhatsAppBotSettings = z.input<typeof whatsappBotSettingsSchema>;

export const whatsappBotResponseSchema = z.object({
  connected: z.boolean(),
  settings: z.object({
    mode: z.enum(REPLY_MODES),
    autoReplyText: z.string().nullable(),
    autoReplyDefault: z.string(),
    statuses: z.array(replyStatusSchema.extend({ preset: z.boolean() })),
    /** The status on now (expired ones come back as null). */
    activeStatus: z.object({ id: z.string(), until: z.string().datetime().nullable() }).nullable(),
    enabled: z.boolean(),
    autoConfirm: z.boolean(),
    /** Only the messages the business rewrote. */
    texts: z.object(
      Object.fromEntries(BOT_TEXT_KEYS.map((k) => [k, z.string().optional()])) as Record<
        BotTextKey,
        z.ZodOptional<z.ZodString>
      >,
    ),
    holdDate: z.boolean(),
    /** The flow in use, and whether it is the industry's default. */
    flow: z.enum(BOT_FLOWS),
    flowIsDefault: z.boolean(),
    /** The industry's default messages (shown until the business writes its own). */
    defaults: z.object(
      Object.fromEntries(BOT_TEXT_KEYS.map((k) => [k, z.string()])) as Record<
        BotTextKey,
        z.ZodString
      >,
    ),
    showcase: z.object({
      enabled: z.boolean(),
      /** Only when the business wrote its own; see `defaultText`. */
      text: z.string().optional(),
      defaultText: z.string(),
      link: z.string().nullable(),
      assetIds: z.array(z.string().uuid()),
      /** Its video (D-151), if one was uploaded; sent after the photos. */
      video: z.object({ sizeBytes: z.number().int() }).nullable().optional(),
    }),
  }),
});
export type WhatsAppBotResponse = z.infer<typeof whatsappBotResponseSchema>;

export const whatsappApiPaths = {
  /** Meta's webhook (verification GET + signed event POST). Public, not tenant-scoped. */
  webhook: '/api/v1/integrations/whatsapp/webhook',
  /** Facebook Messenger's webhook (F23); same Meta app, same signature check. */
  messengerWebhook: '/api/v1/integrations/messenger/webhook',
  /** PUT: the status on now (D-123). */
  status: (businessId: string) => `/api/v1/businesses/${businessId}/whatsapp/status`,
  /** PUT (multipart MP4) / GET / DELETE: the "meanwhile" video (D-151). */
  showcaseVideo: (businessId: string) => `/api/v1/businesses/${businessId}/whatsapp/showcase/video`,
  thread: (businessId: string, leadId: string) =>
    `/api/v1/businesses/${businessId}/leads/${leadId}/whatsapp`,
  inbox: (businessId: string) => `/api/v1/businesses/${businessId}/whatsapp/inbox`,
  personal: (businessId: string) => `/api/v1/businesses/${businessId}/whatsapp/personal`,
  classify: (businessId: string, numberId: string) =>
    `/api/v1/businesses/${businessId}/whatsapp/numbers/${numberId}/classify`,
  /** DELETE: forget a personal marking (the next message lands in the inbox again). */
  number: (businessId: string, numberId: string) =>
    `/api/v1/businesses/${businessId}/whatsapp/numbers/${numberId}`,
  /** PUT: pause or resume the bot for this lead's customer (D-108). */
  botPause: (businessId: string, leadId: string) =>
    `/api/v1/businesses/${businessId}/leads/${leadId}/whatsapp/bot`,
  /** GET / PUT the booking bot settings (D-102). */
  bot: (businessId: string) => `/api/v1/businesses/${businessId}/whatsapp/bot`,
} as const;
