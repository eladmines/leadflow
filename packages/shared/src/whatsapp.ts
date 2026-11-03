import { z } from 'zod';

/**
 * F12 POC — WhatsApp via Meta's Cloud API (D-091, Proposed). An incoming message becomes a lead
 * (source `whatsapp`) or joins the contact's open lead; the team reads the conversation on the lead
 * and replies while WhatsApp's 24-hour customer-service window is open.
 */

/** Free-form replies are allowed for this long after the customer's last message (Meta rule). */
export const WHATSAPP_WINDOW_MS = 24 * 60 * 60 * 1000;
export const WHATSAPP_TEXT_MAX = 1000;

export const whatsappMessages = {
  textRequired: 'יש לכתוב הודעה',
  textTooLong: `ההודעה ארוכה מדי (עד ${WHATSAPP_TEXT_MAX.toLocaleString('en-US')} תווים)`,
  notConnected: 'WhatsApp עדיין לא מחובר לעסק הזה',
  noPhone: 'לליד הזה אין מספר טלפון',
  windowClosed:
    'אפשר לענות בוואטסאפ רק עד 24 שעות אחרי ההודעה האחרונה של הלקוח. כדי לפנות מחדש, התקשרו אליו.',
  sendFailed: 'ההודעה לא נשלחה. נסו שוב בעוד רגע',
  alreadyCustomer: 'המספר כבר משויך ללקוח במערכת. כדי להסיר אותו, מחקו את הליד.',
  notPersonal: 'אפשר לבטל רק סימון של מספר פרטי',
} as const;

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
});
export type WhatsAppMessage = z.infer<typeof whatsappMessageSchema>;

export const whatsappThreadResponseSchema = z.object({
  /** False when no WhatsApp number is connected to this business. */
  connected: z.boolean(),
  /** Oldest first. */
  messages: z.array(whatsappMessageSchema),
  /** End of the 24-hour reply window; null when the customer never wrote or it has closed. */
  replyUntil: z.string().datetime().nullable(),
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
export const whatsappNumberStatusLabels: Record<(typeof WHATSAPP_NUMBER_STATUSES)[number], string> =
  {
    UNCLASSIFIED: 'לא מסווג',
    BUSINESS: 'עסקי',
    PERSONAL: 'פרטי',
  };

export const inboxNumberSchema = z.object({
  id: z.string().uuid(),
  phone: z.string(),
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
export const whatsappBotSettingsSchema = z.object({
  enabled: z.boolean(),
  /** true: booked as confirmed; false: booked as "waiting for approval" (holds the time). */
  autoConfirm: z.boolean(),
});
export type WhatsAppBotSettings = z.infer<typeof whatsappBotSettingsSchema>;

export const whatsappBotResponseSchema = z.object({
  connected: z.boolean(),
  settings: whatsappBotSettingsSchema,
});
export type WhatsAppBotResponse = z.infer<typeof whatsappBotResponseSchema>;

export const whatsappApiPaths = {
  /** Meta's webhook (verification GET + signed event POST). Public, not tenant-scoped. */
  webhook: '/api/v1/integrations/whatsapp/webhook',
  thread: (businessId: string, leadId: string) =>
    `/api/v1/businesses/${businessId}/leads/${leadId}/whatsapp`,
  inbox: (businessId: string) => `/api/v1/businesses/${businessId}/whatsapp/inbox`,
  personal: (businessId: string) => `/api/v1/businesses/${businessId}/whatsapp/personal`,
  classify: (businessId: string, numberId: string) =>
    `/api/v1/businesses/${businessId}/whatsapp/numbers/${numberId}/classify`,
  /** DELETE: forget a personal marking (the next message lands in the inbox again). */
  number: (businessId: string, numberId: string) =>
    `/api/v1/businesses/${businessId}/whatsapp/numbers/${numberId}`,
  /** GET / PUT the booking bot settings (D-102). */
  bot: (businessId: string) => `/api/v1/businesses/${businessId}/whatsapp/bot`,
} as const;
