import type { DomainLookup } from './types';

/** IANA's list of which RDAP server answers for which ending (cached for a day). */
const BOOTSTRAP = 'https://data.iana.org/rdap/dns.json';
const DAY = 86_400_000;

type Fetch = typeof fetch;

/** The `expiration` event of an RDAP domain answer, or null. */
export function expiryFromRdap(body: unknown): Date | null {
  const events = (body as { events?: { eventAction?: unknown; eventDate?: unknown }[] } | null)
    ?.events;
  if (!Array.isArray(events)) return null;
  const e = events.find((x) => x?.eventAction === 'expiration' && typeof x.eventDate === 'string');
  if (!e) return null;
  const d = new Date(e.eventDate as string);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Looks a domain up over RDAP (`.com`, `.net`, `.org` and about 1,200 other endings). */
export class RdapLookup {
  private bootstrap: { at: number; byTld: Map<string, string> } | null = null;

  constructor(
    private readonly doFetch: Fetch = fetch,
    private readonly timeoutMs = 10_000,
  ) {}

  /** True when RDAP has a server for this ending. */
  async supports(domain: string): Promise<boolean> {
    return (await this.baseUrl(domain)) !== null;
  }

  async lookup(domain: string): Promise<DomainLookup> {
    try {
      const base = await this.baseUrl(domain);
      if (!base) return { status: 'unsupported' };
      const res = await this.get(
        `${base.replace(/\/?$/, '/')}domain/${encodeURIComponent(domain)}`,
      );
      if (res.status === 404) return { status: 'failed' };
      if (!res.ok) return { status: 'failed' };
      const expiresAt = expiryFromRdap(await res.json());
      return expiresAt ? { status: 'ok', expiresAt } : { status: 'failed' };
    } catch {
      return { status: 'failed' };
    }
  }

  private async get(url: string) {
    return this.doFetch(url, {
      headers: { accept: 'application/rdap+json, application/json' },
      signal: AbortSignal.timeout(this.timeoutMs),
      redirect: 'follow',
    });
  }

  private async baseUrl(domain: string): Promise<string | null> {
    const tld = domain.split('.').at(-1) ?? '';
    if (!this.bootstrap || Date.now() - this.bootstrap.at > DAY) {
      const res = await this.get(BOOTSTRAP);
      if (!res.ok) throw new Error('rdap bootstrap failed');
      const data = (await res.json()) as { services?: [string[], string[]][] };
      const byTld = new Map<string, string>();
      for (const [tlds, urls] of data.services ?? []) {
        const https = urls.find((u) => u.startsWith('https://')) ?? urls[0];
        if (https) for (const t of tlds) byTld.set(t.toLowerCase(), https);
      }
      this.bootstrap = { at: Date.now(), byTld };
    }
    return this.bootstrap.byTld.get(tld) ?? null;
  }
}
