import type { MessengerSender } from './types';

export interface MessengerCloudOptions {
  pageId: string;
  pageAccessToken: string;
  graphVersion: string;
  /** Injected in tests; defaults to the global fetch. */
  fetch?: typeof fetch;
}

/** Thrown when Meta refuses a message. Carries Meta's numeric code only, never its text. */
export class MessengerSendError extends Error {
  constructor(
    readonly status: number,
    readonly code: number | null,
  ) {
    super(`Messenger send failed (${status}${code ? `/${code}` : ''})`);
    this.name = 'MessengerSendError';
  }
}

/** Meta's Messenger Platform (Graph API `/{page-id}/messages`, Send API). */
export class CloudMessengerSender implements MessengerSender {
  constructor(private readonly opts: MessengerCloudOptions) {}

  async sendText(psid: string, text: string): Promise<{ id: string }> {
    const doFetch = this.opts.fetch ?? fetch;
    const res = await doFetch(
      `https://graph.facebook.com/${this.opts.graphVersion}/${this.opts.pageId}/messages`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.opts.pageAccessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          recipient: { id: psid },
          // A reply inside the 24-hour window the customer's message opened.
          messaging_type: 'RESPONSE',
          message: { text: text.slice(0, 2000) },
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    const json = (await res.json().catch(() => null)) as {
      message_id?: string;
      error?: { code?: number };
    } | null;
    if (!res.ok || !json?.message_id) {
      throw new MessengerSendError(res.status, json?.error?.code ?? null);
    }
    return { id: json.message_id };
  }

  async profileName(psid: string): Promise<string | null> {
    const doFetch = this.opts.fetch ?? fetch;
    try {
      const res = await doFetch(
        `https://graph.facebook.com/${this.opts.graphVersion}/${encodeURIComponent(psid)}?fields=first_name,last_name`,
        {
          headers: { authorization: `Bearer ${this.opts.pageAccessToken}` },
          signal: AbortSignal.timeout(5_000),
        },
      );
      if (!res.ok) return null;
      const json = (await res.json()) as { first_name?: string; last_name?: string };
      const name = [json.first_name, json.last_name].filter(Boolean).join(' ').trim();
      return name || null;
    } catch {
      // No name is fine: the sender shows as "Facebook user".
      return null;
    }
  }
}
