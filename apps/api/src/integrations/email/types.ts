/** A rendered email. `html` and `text` carry the same content. */
export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * Outbound email. Implementations: SMTP (Mailpit locally; a provider later, O-009) and an
 * in-memory adapter for tests. Implementations must never log message bodies (they contain
 * single-use tokens).
 */
export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}
