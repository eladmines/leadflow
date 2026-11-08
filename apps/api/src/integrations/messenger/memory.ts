import { randomUUID } from 'node:crypto';
import type { MessengerSender } from './types';

/** Keeps sent messages in memory instead of calling Meta (local development and tests). */
export class MemoryMessengerSender implements MessengerSender {
  readonly sent: { id: string; to: string; text: string }[] = [];
  /** Profile names to return, by PSID (tests). */
  readonly names = new Map<string, string>();
  /** When set, sending rejects with this error (to test send failures). */
  failWith: Error | null = null;

  sendText(psid: string, text: string): Promise<{ id: string }> {
    if (this.failWith) return Promise.reject(this.failWith);
    const id = `m_local-${randomUUID()}`;
    this.sent.push({ id, to: psid, text });
    return Promise.resolve({ id });
  }

  profileName(psid: string): Promise<string | null> {
    return Promise.resolve(this.names.get(psid) ?? null);
  }

  clear() {
    this.sent.length = 0;
    this.names.clear();
    this.failWith = null;
  }
}
