import { randomUUID } from 'node:crypto';
import type { WhatsAppChoice, WhatsAppSender } from './types';

interface SentMessage {
  id: string;
  to: string;
  text: string;
  /** Buttons or list rows of an interactive message. */
  choices?: WhatsAppChoice[];
  /** Size of a sent photo. */
  imageBytes?: number;
}

/** Keeps sent messages in memory instead of calling Meta (local development and tests). */
export class MemoryWhatsAppSender implements WhatsAppSender {
  readonly sent: SentMessage[] = [];
  /** When set, sending rejects with this error (to test send failures). */
  failWith: Error | null = null;

  private record(message: Omit<SentMessage, 'id'>): Promise<{ id: string }> {
    if (this.failWith) return Promise.reject(this.failWith);
    const id = `wamid.local-${randomUUID()}`;
    this.sent.push({ id, ...message });
    return Promise.resolve({ id });
  }

  sendText(to: string, text: string): Promise<{ id: string }> {
    return this.record({ to, text });
  }

  sendImage(to: string, jpeg: Buffer, caption = ''): Promise<{ id: string }> {
    return this.record({ to, text: caption, imageBytes: jpeg.length });
  }

  sendButtons(to: string, body: string, buttons: WhatsAppChoice[]): Promise<{ id: string }> {
    return this.record({ to, text: body, choices: buttons });
  }

  sendList(to: string, body: string, _button: string, rows: WhatsAppChoice[]) {
    return this.record({ to, text: body, choices: rows });
  }

  clear(): void {
    this.sent.length = 0;
    this.failWith = null;
  }
}
