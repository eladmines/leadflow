import type { GmailApi, GmailMessage, GmailOutgoing, GmailTokens } from './types';

/** Thrown when Google refuses a call. Carries the HTTP status only, never Google's text. */
export class GmailApiError extends Error {
  constructor(readonly status: number) {
    super(`Gmail API failed (${status})`);
    this.name = 'GmailApiError';
  }
}

const SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
].join(' ');
/** Mail Gmail itself files away from the person's main inbox. */
const SKIPPED_LABELS = [
  'CATEGORY_PROMOTIONS',
  'CATEGORY_SOCIAL',
  'CATEGORY_UPDATES',
  'CATEGORY_FORUMS',
];
const MAX_BATCH = 25;

interface Part {
  mimeType?: string;
  body?: { data?: string };
  parts?: Part[];
}
interface RawMessage {
  id: string;
  threadId: string;
  internalDate?: string;
  labelIds?: string[];
  payload?: Part & { headers?: { name: string; value: string }[] };
}

const b64 = (data: string) => Buffer.from(data, 'base64url').toString('utf8');

/** The plain-text body, else the HTML reduced to text. */
function bodyOf(part: Part | undefined): string {
  if (!part) return '';
  const find = (p: Part, type: string): string | null => {
    if (p.mimeType === type && p.body?.data) return b64(p.body.data);
    for (const child of p.parts ?? []) {
      const hit = find(child, type);
      if (hit !== null) return hit;
    }
    return null;
  };
  const text = find(part, 'text/plain');
  if (text !== null) return text;
  const html = find(part, 'text/html');
  return html === null
    ? ''
    : html
        .replace(/<(style|script)[\s\S]*?<\/\1>/gi, '')
        .replace(/<br\s*\/?>|<\/(p|div|tr|li)>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/** "Dana <dana@x.com>" → name and address. */
export function parseFrom(value: string): { name: string | null; address: string } {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(value);
  const address = (m ? m[2]! : value).trim().toLowerCase();
  const name = m?.[1]?.trim();
  return { name: name || null, address };
}

export function toMessage(raw: RawMessage): GmailMessage {
  const headers = new Map<string, string>();
  for (const h of raw.payload?.headers ?? []) headers.set(h.name.toLowerCase(), h.value);
  const from = parseFrom(headers.get('from') ?? '');
  const precedence = (headers.get('precedence') ?? '').toLowerCase();
  const auto = (headers.get('auto-submitted') ?? 'no').toLowerCase() !== 'no';
  const skip =
    auto ||
    headers.has('list-unsubscribe') ||
    headers.has('x-autoreply') ||
    ['bulk', 'list', 'junk'].includes(precedence) ||
    /^(no-?reply|do-?not-?reply|mailer-daemon|postmaster)@/.test(from.address) ||
    (raw.labelIds ?? []).some((l) => SKIPPED_LABELS.includes(l) || l === 'SPAM' || l === 'DRAFT');
  return {
    id: raw.id,
    threadId: raw.threadId,
    messageId: (headers.get('message-id') ?? '').replace(/^<|>$/g, '').trim(),
    from: from.address,
    fromName: from.name,
    subject: headers.get('subject') ?? '',
    text: bodyOf(raw.payload),
    receivedAt: Number(raw.internalDate ?? Date.now()),
    skip,
  };
}

/** Google's OAuth and Gmail REST APIs. */
export class CloudGmailApi implements GmailApi {
  readonly available = true;
  constructor(
    private readonly opts: {
      clientId: string;
      clientSecret: string;
      /** Injected in tests; defaults to the global fetch. */
      fetch?: typeof fetch;
    },
  ) {}

  private async call<T>(url: string, init: RequestInit = {}): Promise<T> {
    const doFetch = this.opts.fetch ?? fetch;
    const res = await doFetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
    const json = (await res.json().catch(() => null)) as T | null;
    if (!res.ok || json === null) throw new GmailApiError(res.status);
    return json;
  }

  private token(params: Record<string, string>) {
    return this.call<{ access_token?: string; refresh_token?: string; id_token?: string }>(
      'https://oauth2.googleapis.com/token',
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: this.opts.clientId,
          client_secret: this.opts.clientSecret,
          ...params,
        }),
      },
    );
  }

  authUrl(redirectUri: string, state: string): string {
    return `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
      client_id: this.opts.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: SCOPES,
      access_type: 'offline',
      // Always ask, so Google returns a refresh token every time.
      prompt: 'consent',
      state,
    })}`;
  }

  async exchangeCode(code: string, redirectUri: string): Promise<GmailTokens> {
    const json = await this.token({
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    });
    if (!json.access_token || !json.refresh_token) throw new GmailApiError(200);
    const profile = await this.call<{ emailAddress?: string }>(
      'https://gmail.googleapis.com/gmail/v1/users/me/profile',
      { headers: { authorization: `Bearer ${json.access_token}` } },
    );
    if (!profile.emailAddress) throw new GmailApiError(200);
    return { refreshToken: json.refresh_token, email: profile.emailAddress.toLowerCase() };
  }

  async accessToken(refreshToken: string): Promise<string> {
    const json = await this.token({ refresh_token: refreshToken, grant_type: 'refresh_token' });
    if (!json.access_token) throw new GmailApiError(200);
    return json.access_token;
  }

  async listInbox(accessToken: string, afterMs: number): Promise<GmailMessage[]> {
    const auth = { headers: { authorization: `Bearer ${accessToken}` } };
    // `after:` takes seconds; one second back so a message at the boundary is never missed
    // (the caller drops what it has already seen).
    const q = `in:inbox after:${Math.max(0, Math.floor(afterMs / 1000) - 1)}`;
    const list = await this.call<{ messages?: { id: string }[] }>(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?${new URLSearchParams({ q, maxResults: String(MAX_BATCH) })}`,
      auth,
    );
    const out: GmailMessage[] = [];
    for (const { id } of list.messages ?? []) {
      const raw = await this.call<RawMessage>(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`,
        auth,
      );
      out.push(toMessage(raw));
    }
    return out.sort((a, b) => a.receivedAt - b.receivedAt);
  }

  async send(accessToken: string, mail: GmailOutgoing): Promise<{ id: string }> {
    const header = (v: string) => v.replace(/[\r\n]+/g, ' ');
    const subject = `=?UTF-8?B?${Buffer.from(header(mail.subject)).toString('base64')}?=`;
    const lines = [
      `From: ${header(mail.from)}`,
      `To: ${header(mail.to)}`,
      `Subject: ${subject}`,
      ...(mail.inReplyTo
        ? [`In-Reply-To: <${header(mail.inReplyTo)}>`, `References: <${header(mail.inReplyTo)}>`]
        : []),
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from(mail.text).toString('base64'),
    ];
    const json = await this.call<{ id?: string }>(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          raw: Buffer.from(lines.join('\r\n')).toString('base64url'),
          ...(mail.threadId ? { threadId: mail.threadId } : {}),
        }),
      },
    );
    if (!json.id) throw new GmailApiError(200);
    return { id: json.id };
  }

  async revoke(refreshToken: string): Promise<void> {
    await this.call(
      `https://oauth2.googleapis.com/revoke?${new URLSearchParams({ token: refreshToken })}`,
      { method: 'POST' },
    ).catch(() => undefined);
  }
}
