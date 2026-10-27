import type { EmailMessage, EmailSender } from './types';

/** Keeps sent messages in memory so tests can read links out of them. */
export class MemoryEmailSender implements EmailSender {
  readonly sent: EmailMessage[] = [];
  /** When set, `send` rejects with this error (to test send failures). */
  failWith: Error | null = null;

  send(message: EmailMessage): Promise<void> {
    if (this.failWith) return Promise.reject(this.failWith);
    this.sent.push(message);
    return Promise.resolve();
  }

  /** Messages sent to `to` (normalised, case-insensitive), oldest first. */
  to(to: string): EmailMessage[] {
    const addr = to.trim().toLowerCase();
    return this.sent.filter((m) => m.to.toLowerCase() === addr);
  }

  clear(): void {
    this.sent.length = 0;
    this.failWith = null;
  }
}
