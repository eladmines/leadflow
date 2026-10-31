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

export const whatsappApiPaths = {
  /** Meta's webhook (verification GET + signed event POST). Public, not tenant-scoped. */
  webhook: '/api/v1/integrations/whatsapp/webhook',
  thread: (businessId: string, leadId: string) =>
    `/api/v1/businesses/${businessId}/leads/${leadId}/whatsapp`,
} as const;
