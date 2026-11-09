/** A Facebook Page the signed-in person manages, with its Page access token. */
export interface MetaPage {
  id: string;
  name: string;
  accessToken: string;
}

/**
 * Meta's Graph API for connecting channels (F25, D-159): Facebook sign-in, the person's Pages,
 * subscribing a Page to the app's webhook, and checking a WhatsApp number. Implementations never
 * log tokens or Meta's error texts.
 */
export interface MetaApi {
  /** Facebook Login: exchanges the `code` for the person's access token. */
  exchangeCode(code: string, redirectUri: string): Promise<string>;
  /** The Pages the person manages, each with its own token. */
  pages(userToken: string): Promise<MetaPage[]>;
  /** Sends the Page's messages to this app's webhook. */
  subscribePage(pageId: string, pageToken: string): Promise<void>;
  unsubscribePage(pageId: string, pageToken: string): Promise<void>;
  /** The number behind a WhatsApp "Phone number ID", or null when the token can't reach it. */
  whatsappNumber(phoneNumberId: string, accessToken: string): Promise<string | null>;
}
