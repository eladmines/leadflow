import type { WhatsAppChoice, WhatsAppSender } from './types';

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

  sendText(to: string, text: string, opts: { preview?: boolean } = {}): Promise<{ id: string }> {
    return this.post(to, {
      type: 'text',
      text: { body: text, preview_url: opts.preview ?? false },
    });
  }

  /** Uploads the photo to Meta (no public URL needed), then sends it by its media id. */
  async sendImage(to: string, jpeg: Buffer, caption?: string): Promise<{ id: string }> {
    const mediaId = await this.upload(jpeg, 'image/jpeg', 'photo.jpg', 20_000);
    return this.post(to, {
      type: 'image',
      image: { id: mediaId, ...(caption ? { caption: caption.slice(0, 1024) } : {}) },
    });
  }

  async sendVideo(to: string, mp4: Buffer, caption?: string): Promise<{ id: string }> {
    const mediaId = await this.upload(mp4, 'video/mp4', 'video.mp4', 60_000);
    return this.post(to, {
      type: 'video',
      video: { id: mediaId, ...(caption ? { caption: caption.slice(0, 1024) } : {}) },
    });
  }

  /** Uploads a file to Meta's media store; resolves with its media id. */
  private async upload(body: Buffer, type: string, name: string, timeoutMs: number) {
    const doFetch = this.opts.fetch ?? fetch;
    const form = new FormData();
    form.set('messaging_product', 'whatsapp');
    form.set('type', type);
    form.set('file', new Blob([new Uint8Array(body)], { type }), name);
    const res = await doFetch(
      `https://graph.facebook.com/${this.opts.graphVersion}/${this.opts.phoneNumberId}/media`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${this.opts.accessToken}` },
        body: form,
        signal: AbortSignal.timeout(timeoutMs),
      },
    );
    const json = (await res.json().catch(() => null)) as {
      id?: string;
      error?: { code?: number };
    } | null;
    if (!res.ok || !json?.id) throw new WhatsAppSendError(res.status, json?.error?.code ?? null);
    return json.id;
  }

  sendButtons(to: string, body: string, buttons: WhatsAppChoice[]): Promise<{ id: string }> {
    return this.post(to, {
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: body },
        action: {
          buttons: buttons.slice(0, 3).map((b) => ({
            type: 'reply',
            reply: { id: b.id, title: b.title.slice(0, 20) },
          })),
        },
      },
    });
  }

  sendList(to: string, body: string, button: string, rows: WhatsAppChoice[]) {
    return this.post(to, {
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text: body },
        action: {
          button: button.slice(0, 20),
          sections: [
            {
              rows: rows.slice(0, 10).map((r) => ({
                id: r.id,
                title: r.title.slice(0, 24),
                ...(r.description ? { description: r.description.slice(0, 72) } : {}),
              })),
            },
          ],
        },
      },
    });
  }

  private async post(to: string, message: object): Promise<{ id: string }> {
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
          ...message,
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
