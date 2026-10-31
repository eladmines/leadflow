/**
 * Outbound WhatsApp messages. Implementations: Meta's Cloud API and an in-memory adapter (local
 * development and tests). Implementations must never log message texts or phone numbers.
 */
export interface WhatsAppSender {
  /** Sends a free-form text to an E.164 number; resolves with Meta's message id. */
  sendText(to: string, text: string): Promise<{ id: string }>;
}
