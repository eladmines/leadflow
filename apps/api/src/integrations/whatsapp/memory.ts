import { randomUUID } from 'node:crypto';
import type { WhatsAppSender } from './types';

/** Keeps sent messages in memory instead of calling Meta (local development and tests). */
export class MemoryWhatsAppSender implements WhatsAppSender {
  readonly sent: { id: string; to: string; text: string }[] = [];
  /** When set, `sendText` rejects with this error (to test send failures). */
  failWith: Error | null = null;

  sendText(to: string, text: string): Promise<{ id: string }> {
    if (this.failWith) return Promise.reject(this.failWith);
    const id = `wamid.local-${randomUUID()}`;
    this.sent.push({ id, to, text });
    return Promise.resolve({ id });
  }

  clear(): void {
    this.sent.length = 0;
    this.failWith = null;
  }
}
