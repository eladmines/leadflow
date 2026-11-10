/** A rendered email. `html` and `text` carry the same content. */
export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Sender override ("Name <address>"); default is the server's `EMAIL_FROM` (F27: a business replies as itself). */
  from?: string;
  replyTo?: string;
  /** Message-ID this answers, so the customer's mail program threads it (F27). */
  inReplyTo?: string;
}

/**
 * Outbound email. Implementations: SMTP (Mailpit locally), Brevo over HTTPS, disabled (D-120),
 * and an in-memory adapter for tests. Implementations must never log message bodies (they contain
 * single-use tokens).
 */
export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}
