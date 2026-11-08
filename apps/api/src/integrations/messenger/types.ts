/**
 * Facebook Messenger for a Page (F23, D-157). Implementations: Meta's Graph API and an in-memory
 * adapter (local development and tests). Implementations must never log message texts or PSIDs.
 */
export interface MessengerSender {
  /** Sends a text reply to a sender (by page-scoped id); resolves with Meta's message id. */
  sendText(psid: string, text: string): Promise<{ id: string }>;
  /** The sender's name from their Facebook profile, or null when Meta doesn't share it. */
  profileName(psid: string): Promise<string | null>;
}
