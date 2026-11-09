import { z } from 'zod';
import { channelSchema, whatsappMessageSchema } from './whatsapp';

/**
 * F24 unified inbox (D-158): every conversation — WhatsApp, Facebook Messenger — in one list. A
 * conversation is one sender on one channel; personal numbers never appear.
 */

export const CONVERSATION_FILTERS = ['all', 'unread', 'new'] as const;
export type ConversationFilter = (typeof CONVERSATION_FILTERS)[number];
export const CONVERSATIONS_PAGE = 30;

export const conversationListQuerySchema = z.object({
  filter: z.enum(CONVERSATION_FILTERS).default('all'),
  channel: channelSchema.optional(),
  /** From the previous page's `nextCursor`. */
  cursor: z
    .string()
    .regex(/^\d{13}_[0-9a-f-]{36}$/)
    .optional(),
});
export type ConversationListQuery = z.input<typeof conversationListQuerySchema>;

export const conversationSummarySchema = z.object({
  id: z.string().uuid(),
  channel: channelSchema,
  /** New = not classified yet (Business / Personal). */
  status: z.enum(['UNCLASSIFIED', 'BUSINESS']),
  /** The contact's name, the sender's profile name, or null (then show the phone). */
  name: z.string().nullable(),
  /** WhatsApp only (E.164); null on Facebook. */
  phone: z.string().nullable(),
  leadId: z.string().uuid().nullable(),
  lastMessage: z
    .object({ body: z.string(), direction: z.enum(['IN', 'OUT']), at: z.string().datetime() })
    .nullable(),
  lastMessageAt: z.string().datetime(),
  /** A customer message nobody has opened yet (shared by the team). */
  unread: z.boolean(),
});
export type ConversationSummary = z.infer<typeof conversationSummarySchema>;

export const conversationListResponseSchema = z.object({
  /** At least one channel is connected to this business. */
  connected: z.boolean(),
  conversations: z.array(conversationSummarySchema),
  nextCursor: z.string().nullable(),
  /** Unread conversations in the whole inbox (for the menu badge). */
  unreadCount: z.number().int(),
});
export type ConversationListResponse = z.infer<typeof conversationListResponseSchema>;

export const conversationResponseSchema = z.object({
  conversation: conversationSummarySchema,
  /** Oldest first (the latest 200). */
  messages: z.array(whatsappMessageSchema),
  /** End of the 24-hour reply window; null when it has closed. */
  replyUntil: z.string().datetime().nullable(),
});
export type ConversationResponse = z.infer<typeof conversationResponseSchema>;

export const unreadConversationsResponseSchema = z.object({ unreadCount: z.number().int() });

const base = (businessId: string) => `/api/v1/businesses/${businessId}/conversations`;
export const conversationsApiPaths = {
  /** GET: the inbox (`?filter=&channel=&cursor=`). */
  list: base,
  /** GET: just the unread count (menu badge). */
  unread: (businessId: string) => `${base(businessId)}/unread`,
  /** GET: one conversation with its messages. */
  detail: (businessId: string, id: string) => `${base(businessId)}/${id}`,
  /** POST: reply through the conversation's channel. */
  messages: (businessId: string, id: string) => `${base(businessId)}/${id}/messages`,
  /** POST: mark read. */
  read: (businessId: string, id: string) => `${base(businessId)}/${id}/read`,
} as const;
