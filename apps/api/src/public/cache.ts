/**
 * In-process cache of published pages by subdomain, shared by the API (which invalidates it on
 * publish / rollback / unpublish / address change) and the public-site server (which reads it).
 * Single-process MVP; the Cloudflare Worker + R2 setup replaces it in production (D-036).
 */
export interface PublishedPage {
  html: string | null;
  /** Extra pages' HTML by address (D-081). */
  pages: Record<string, string>;
  versionId: string | null;
  updatedAt: Date | null;
}

export class PublishedSiteCache {
  private entries = new Map<string, PublishedPage & { expires: number }>();

  constructor(private readonly ttlMs = 30_000) {}

  get(subdomain: string): PublishedPage | undefined {
    const hit = this.entries.get(subdomain);
    if (!hit) return undefined;
    if (hit.expires <= Date.now()) {
      this.entries.delete(subdomain);
      return undefined;
    }
    return hit;
  }

  set(subdomain: string, page: PublishedPage) {
    if (this.ttlMs > 0) this.entries.set(subdomain, { ...page, expires: Date.now() + this.ttlMs });
  }

  invalidate(...subdomains: (string | null | undefined)[]) {
    for (const s of subdomains) if (s) this.entries.delete(s);
  }
}
