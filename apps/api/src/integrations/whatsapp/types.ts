/** A tappable choice in an interactive message; `id` comes back in the customer's reply. */
export interface WhatsAppChoice {
  id: string;
  /** Up to 24 characters in a list, 20 on a button (longer ones are cut). */
  title: string;
  /** List rows only, up to 72 characters. */
  description?: string;
}

/**
 * Outbound WhatsApp messages. Implementations: Meta's Cloud API and an in-memory adapter (local
 * development and tests). Implementations must never log message texts or phone numbers.
 */
export interface WhatsAppSender {
  /**
   * Sends a free-form text to an E.164 number; resolves with Meta's message id. `preview` shows a
   * preview of the first link (e.g. a video).
   */
  sendText(to: string, text: string, opts?: { preview?: boolean }): Promise<{ id: string }>;
  /** A JPEG photo with an optional caption. */
  sendImage(to: string, jpeg: Buffer, caption?: string): Promise<{ id: string }>;
  /** A text with up to 3 reply buttons. */
  sendButtons(to: string, body: string, buttons: WhatsAppChoice[]): Promise<{ id: string }>;
  /** A text with a button that opens a list of up to 10 rows. */
  sendList(
    to: string,
    body: string,
    button: string,
    rows: WhatsAppChoice[],
  ): Promise<{ id: string }>;
}
