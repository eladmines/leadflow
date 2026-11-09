import { z } from 'zod';
import { channelSchema } from './whatsapp';

/**
 * F25 (D-159): the channels a business connects itself — its WhatsApp number and Facebook Page.
 * Tokens are stored encrypted on the server and never come back to the browser.
 */

export const channelsMessages = {
  phoneNumberIdInvalid: 'יש להזין את ה-Phone number ID (מספרים בלבד)',
  tokenRequired: 'יש להדביק את טוקן הגישה',
  whatsappInvalid:
    'לא הצלחנו להגיע למספר עם הפרטים האלה. בדקו את ה-Phone number ID ואת טוקן הגישה.',
  alreadyTaken: 'המספר או הדף כבר מחוברים לעסק אחר.',
  facebookUnavailable: 'חיבור לפייסבוק עוד לא הוגדר במערכת.',
  facebookFailed: 'החיבור לפייסבוק לא הצליח. נסו שוב.',
  facebookExpired: 'החיבור לפייסבוק פג תוקף. התחילו שוב.',
  noPages: 'לא מצאנו דפי פייסבוק שאתם מנהלים בחשבון הזה.',
} as const;

export const channelStatusSchema = z.object({
  channel: channelSchema,
  connected: z.boolean(),
  /** The number or the Page's name. */
  name: z.string().nullable(),
  /** Connected from this screen, or the system-wide test connection (server settings). */
  source: z.enum(['business', 'environment']).nullable(),
});
export type ChannelStatus = z.infer<typeof channelStatusSchema>;

export const channelsResponseSchema = z.object({
  whatsapp: channelStatusSchema,
  messenger: channelStatusSchema,
  /** "Connect Facebook" is set up on the server (the Meta app id is known). */
  facebookLogin: z.boolean(),
});
export type ChannelsResponse = z.infer<typeof channelsResponseSchema>;

export const connectWhatsAppRequestSchema = z.object({
  phoneNumberId: z
    .string()
    .trim()
    .regex(/^\d{5,30}$/, channelsMessages.phoneNumberIdInvalid),
  accessToken: z.string().trim().min(20, channelsMessages.tokenRequired).max(4000),
});
export type ConnectWhatsAppRequest = z.infer<typeof connectWhatsAppRequestSchema>;

export const facebookStartResponseSchema = z.object({ url: z.string().url() });
export const facebookPagesResponseSchema = z.object({
  pages: z.array(z.object({ id: z.string(), name: z.string() })),
});
export type FacebookPagesResponse = z.infer<typeof facebookPagesResponseSchema>;

export const connectFacebookRequestSchema = z.object({
  pendingId: z.string().uuid(),
  pageId: z.string().regex(/^\d{1,40}$/),
});
export type ConnectFacebookRequest = z.infer<typeof connectFacebookRequestSchema>;

const base = (businessId: string) => `/api/v1/businesses/${businessId}/channels`;
export const channelsApiPaths = {
  /** GET: both channels' status. */
  list: base,
  /** POST: connect WhatsApp with a Phone number ID and access token. */
  whatsapp: (businessId: string) => `${base(businessId)}/whatsapp`,
  /** GET: where to send the person for Facebook sign-in. */
  facebookStart: (businessId: string) => `${base(businessId)}/facebook/start`,
  /** GET: the Pages to choose from after sign-in. */
  facebookPages: (businessId: string, pendingId: string) =>
    `${base(businessId)}/facebook/pending/${pendingId}`,
  /** POST: connect the chosen Page. */
  facebook: (businessId: string) => `${base(businessId)}/facebook`,
  /** DELETE: disconnect a channel. */
  channel: (businessId: string, channel: string) => `${base(businessId)}/${channel}`,
  /** Facebook sends the person back here after sign-in (public, checked by its signed state). */
  facebookCallback: '/api/v1/integrations/facebook/callback',
} as const;
