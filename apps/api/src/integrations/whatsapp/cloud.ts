import type { WhatsAppSender } from './types';

export interface CloudApiOptions {
  phoneNumberId: string;
  accessToken: string;
  graphVersion: string;
  /** Injected in tests; defaults to the global fetch. */
  fetch?: typeof fetch;
}

/** Thrown when Meta refuses a message. Carries Meta's numeric code only, never its text. */
export class WhatsAppSendError extends Error {
  constructor(
    readonly status: number,
    readonly code: number | null,
  ) {
    super(`WhatsApp send failed (${status}${code ? `/${code}` : ''})`);
    this.name = 'WhatsAppSendError';
  }
}

/** Meta's WhatsApp Cloud API (Graph API `/{phone-number-id}/messages`). */
export class CloudWhatsAppSender implements WhatsAppSender {
  constructor(private readonly opts: CloudApiOptions) {}

  async sendText(to: string, text: string): Promise<{ id: string }> {
    const doFetch = this.opts.fetch ?? fetch;
    const res = await doFetch(
      `https://graph.facebook.com/${this.opts.graphVersion}/${this.opts.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.opts.accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          // Meta wants the number without "+".
          to: to.replace(/^\+/, ''),
          type: 'text',
          text: { body: text, preview_url: false },
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    const json = (await res.json().catch(() => null)) as {
      messages?: { id?: string }[];
      error?: { code?: number };
    } | null;
    const id = json?.messages?.[0]?.id;
    if (!res.ok || !id) throw new WhatsAppSendError(res.status, json?.error?.code ?? null);
    return { id };
  }
}
