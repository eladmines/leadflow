import type { MetaApi, MetaPage } from './types';

/** Thrown when Meta refuses a call. Carries Meta's numeric code only, never its text. */
export class MetaApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: number | null,
  ) {
    super(`Meta API failed (${status}${code ? `/${code}` : ''})`);
    this.name = 'MetaApiError';
  }
}

export class CloudMetaApi implements MetaApi {
  constructor(
    private readonly opts: {
      appId: string;
      appSecret: string;
      graphVersion: string;
      fetch?: typeof fetch;
    },
  ) {}

  private url(path: string, query: Record<string, string> = {}) {
    const q = new URLSearchParams(query).toString();
    return `https://graph.facebook.com/${this.opts.graphVersion}/${path}${q ? `?${q}` : ''}`;
  }

  private async call<T>(url: string, init: RequestInit & { token?: string } = {}): Promise<T> {
    const doFetch = this.opts.fetch ?? fetch;
    const { token, ...rest } = init;
    const res = await doFetch(url, {
      ...rest,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...rest.headers },
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json().catch(() => null)) as (T & { error?: { code?: number } }) | null;
    if (!res.ok || !json) throw new MetaApiError(res.status, json?.error?.code ?? null);
    return json;
  }

  async exchangeCode(code: string, redirectUri: string): Promise<string> {
    const json = await this.call<{ access_token?: string }>(
      this.url('oauth/access_token', {
        client_id: this.opts.appId,
        client_secret: this.opts.appSecret,
        redirect_uri: redirectUri,
        code,
      }),
    );
    if (!json.access_token) throw new MetaApiError(200, null);
    return json.access_token;
  }

  async pages(userToken: string): Promise<MetaPage[]> {
    const json = await this.call<{ data?: { id: string; name: string; access_token: string }[] }>(
      this.url('me/accounts', { fields: 'id,name,access_token', limit: '100' }),
      { token: userToken },
    );
    return (json.data ?? []).map((p) => ({ id: p.id, name: p.name, accessToken: p.access_token }));
  }

  async subscribePage(pageId: string, pageToken: string): Promise<void> {
    await this.call(
      this.url(`${encodeURIComponent(pageId)}/subscribed_apps`, { subscribed_fields: 'messages' }),
      { method: 'POST', token: pageToken },
    );
  }

  async unsubscribePage(pageId: string, pageToken: string): Promise<void> {
    await this.call(this.url(`${encodeURIComponent(pageId)}/subscribed_apps`), {
      method: 'DELETE',
      token: pageToken,
    });
  }

  async whatsappNumber(phoneNumberId: string, accessToken: string): Promise<string | null> {
    try {
      const json = await this.call<{ display_phone_number?: string }>(
        this.url(encodeURIComponent(phoneNumberId), { fields: 'display_phone_number' }),
        { token: accessToken },
      );
      return json.display_phone_number ?? null;
    } catch {
      return null;
    }
  }
}
