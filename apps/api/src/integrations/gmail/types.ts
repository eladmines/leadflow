/** One inbox message, already parsed (F29). */
export interface GmailMessage {
  /** Gmail's own id. */
  id: string;
  threadId: string;
  /** The RFC 5322 Message-ID header (without the angle brackets); empty if the mail has none. */
  messageId: string;
  from: string;
  fromName: string | null;
  subject: string;
  text: string;
  /** When Gmail received it (ms since epoch). */
  receivedAt: number;
  /** Mail we shouldn't answer or file: bulk, lists, auto-replies, no-reply senders. */
  skip: boolean;
}

export interface GmailTokens {
  refreshToken: string;
  /** The Gmail address that signed in. */
  email: string;
}

export interface GmailOutgoing {
  from: string;
  to: string;
  subject: string;
  text: string;
  /** Message-ID of the mail being answered, for threading. */
  inReplyTo?: string;
  threadId?: string;
}

/**
 * Google's Gmail API for the connected inbox (F29, D-188): sign-in, reading new mail, replying.
 * Implementations never log tokens, addresses or message texts.
 */
export interface GmailApi {
  /** Where to send the person for Google's consent screen. */
  authUrl(redirectUri: string, state: string): string;
  /** Exchanges the sign-in `code`: the long-lived refresh token and the account's address. */
  exchangeCode(code: string, redirectUri: string): Promise<GmailTokens>;
  /** A short-lived access token; throws when Google no longer accepts the refresh token. */
  accessToken(refreshToken: string): Promise<string>;
  /** Inbox messages received after `afterMs`, oldest first (a bounded batch). */
  listInbox(accessToken: string, afterMs: number): Promise<GmailMessage[]>;
  /** Sends a reply from the account; resolves with Gmail's message id. */
  send(accessToken: string, mail: GmailOutgoing): Promise<{ id: string }>;
  /** Tells Google the grant is no longer used (best effort). */
  revoke(refreshToken: string): Promise<void>;
}
