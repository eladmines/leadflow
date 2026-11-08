import { z } from 'zod';

/**
 * In-app notifications (D-097): a bell with the unread count and a list, plus short pop-ups for the
 * urgent ones. Each notification is for one user in one business; the server decides who gets it
 * using the same visibility rules as the rest of the CRM.
 */

export const NOTIFICATION_TYPES = [
  'lead.new',
  'whatsapp.message',
  'whatsapp.new_number',
  'appointment.booked',
  'appointment.cancelled',
  'quote.accepted',
  'quote.rejected',
  'task.due',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** Types that also pop up while the app is open. */
export const URGENT_NOTIFICATION_TYPES: readonly NotificationType[] = [
  'lead.new',
  'whatsapp.message',
  'whatsapp.new_number',
  'appointment.booked',
  'appointment.cancelled',
];

export const notificationSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(NOTIFICATION_TYPES),
  /** Type-specific details (ids for the link, a name, a short preview). */
  data: z.record(z.unknown()),
  readAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type Notification = z.infer<typeof notificationSchema>;

export const notificationListResponseSchema = z.object({
  /** Newest first (the latest 30). */
  notifications: z.array(notificationSchema),
  unreadCount: z.number().int(),
});
export type NotificationListResponse = z.infer<typeof notificationListResponseSchema>;

/** Marks these notifications read; without `ids`, all of the user's notifications here. */
export const markNotificationsReadRequestSchema = z.object({
  ids: z.array(z.string().uuid()).max(100).optional(),
});
export type MarkNotificationsReadRequest = z.infer<typeof markNotificationsReadRequestSchema>;

const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** Hebrew title and line for a notification. */
export function notificationText(n: Pick<Notification, 'type' | 'data'>): {
  title: string;
  body: string;
} {
  const d = n.data;
  switch (n.type) {
    case 'lead.new':
      return {
        title:
          d.source === 'whatsapp'
            ? 'ליד חדש מוואטסאפ'
            : d.source === 'facebook'
              ? 'ליד חדש מפייסבוק'
              : 'ליד חדש מהאתר',
        body: str(d.appointment)
          ? `${str(d.name)} · בקשה לתור: ${str(d.appointment)}`
          : str(d.name),
      };
    case 'whatsapp.message':
      return { title: `הודעה מ${str(d.name)}`, body: str(d.preview) };
    case 'whatsapp.new_number':
      return {
        title: d.channel === 'messenger' ? 'פנייה חדשה בפייסבוק' : 'מספר חדש כתב בוואטסאפ',
        body: `${str(d.name)} · מחכה לסיווג`,
      };
    case 'appointment.booked':
      return {
        title: d.pending ? 'בקשה לתור מוואטסאפ' : 'תור חדש מוואטסאפ',
        body: `${str(d.name)} · ${str(d.when)}`,
      };
    case 'appointment.cancelled':
      return { title: 'לקוח ביטל תור בוואטסאפ', body: `${str(d.name)} · ${str(d.when)}` };
    case 'quote.accepted':
      return { title: 'הצעת מחיר אושרה', body: `${str(d.name)} · הצעה מס׳ ${str(d.number)}` };
    case 'quote.rejected':
      return { title: 'הצעת מחיר נדחתה', body: `${str(d.name)} · הצעה מס׳ ${str(d.number)}` };
    case 'task.due':
      return { title: 'הגיע הזמן למשימה', body: str(d.title) };
  }
}

/** Where clicking the notification leads (web path). */
export function notificationPath(businessId: string, n: Pick<Notification, 'type' | 'data'>) {
  const base = `/b/${businessId}`;
  const d = n.data;
  if (n.type === 'whatsapp.new_number') return `${base}/conversations`;
  if (n.type === 'quote.accepted' || n.type === 'quote.rejected') {
    return `${base}/quotes/${str(d.quoteId)}`;
  }
  if (n.type === 'task.due' && !str(d.leadId)) return `${base}/tasks`;
  return `${base}/leads/${str(d.leadId)}`;
}

export const notificationsApiPaths = {
  list: (businessId: string) => `/api/v1/businesses/${businessId}/notifications`,
  read: (businessId: string) => `/api/v1/businesses/${businessId}/notifications/read`,
} as const;
