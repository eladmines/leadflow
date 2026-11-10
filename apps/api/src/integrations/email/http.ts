import type { EmailMessage, EmailSender } from './types';

/** "LeadFlow <me@gmail.com>" or "me@gmail.com" → name and address. */
export function parseSender(from: string): { name?: string; email: string } {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from);
  return m ? { ...(m[1] ? { name: m[1] } : {}), email: m[2]! } : { email: from.trim() };
}

/**
 * Brevo's email API over HTTPS (D-120): works where outgoing SMTP ports are blocked (Render's
 * free plan), and sends from a verified single address — no domain needed. Never logs or
 * returns message content (it carries single-use tokens).
 */
export class BrevoEmailSender implements EmailSender {
  constructor(private readonly opts: { apiKey: string; from: string; fetch?: typeof fetch }) {}

  async send(message: EmailMessage): Promise<void> {
    const res = await (this.opts.fetch ?? fetch)('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': this.opts.apiKey,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender: parseSender(message.from ?? this.opts.from),
        to: [{ email: message.to }],
        ...(message.replyTo ? { replyTo: parseSender(message.replyTo) } : {}),
        ...(message.inReplyTo ? { headers: { 'In-Reply-To': message.inReplyTo } } : {}),
        subject: message.subject,
        htmlContent: message.html,
        textContent: message.text,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`email provider responded ${res.status}`);
  }
}

/**
 * No email at all (D-120): for hosting where none is set up yet. Sends nothing and returns at
 * once, so nothing waits on a mail server that can't be reached.
 */
export class DisabledEmailSender implements EmailSender {
  async send(): Promise<void> {}
}
