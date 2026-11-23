import { z } from 'zod';

/**
 * F33 — when the domain of the business's existing website expires, so it isn't forgotten. Read from
 * the registry (RDAP, or ISOC-IL's WHOIS for `.il`); never typed in by hand.
 */

/** Two-label public suffixes we meet (`name.co.il` is the domain, not `co.il`). */
const SECOND_LEVEL = new Set([
  'co.il',
  'org.il',
  'net.il',
  'ac.il',
  'muni.il',
  'k12.il',
  'gov.il',
  'idf.il',
  'co.uk',
  'org.uk',
  'me.uk',
  'ac.uk',
  'com.au',
  'net.au',
  'org.au',
  'co.nz',
  'com.br',
  'co.za',
  'co.jp',
  'com.tr',
]);

/** `https://www.shiran.co.il/about` → `shiran.co.il`; null when it isn't a normal domain name. */
export function registrableDomain(input: string | null | undefined): string | null {
  if (!input) return null;
  let host: string;
  try {
    host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`).hostname;
  } catch {
    return null;
  }
  host = host.toLowerCase().replace(/\.$/, '');
  // No IP addresses, no single labels (localhost), nothing with unusual characters.
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) || /^\d+(\.\d+){3}$/.test(host)) return null;
  const labels = host.split('.');
  const suffixLabels = SECOND_LEVEL.has(labels.slice(-2).join('.')) ? 2 : 1;
  if (labels.length <= suffixLabels) return null;
  return labels.slice(-(suffixLabels + 1)).join('.');
}

/** The reminders, in days before the expiry (0 = the day it expires, or after). */
export const DOMAIN_REMINDER_DAYS = [60, 30, 7, 0] as const;

export const DOMAIN_CHECKS = ['ok', 'unsupported', 'failed'] as const;

export const domainExpiryResponseSchema = z.object({
  /** The domain being watched; null when the business has no existing website. */
  domain: z.string().nullable(),
  /** `ok` (read), `unsupported` (this ending has no public lookup), `failed` (try again later); null: not checked yet. */
  check: z.enum(DOMAIN_CHECKS).nullable(),
  expiresAt: z.string().datetime().nullable(),
  checkedAt: z.string().datetime().nullable(),
  /** Whole days until it expires (negative when it already has); null without a date. */
  daysLeft: z.number().int().nullable(),
  /** A lookup is running right now (it started because it was never done, or is a day old): ask again in a moment. */
  checking: z.boolean(),
});
export type DomainExpiryResponse = z.infer<typeof domainExpiryResponseSchema>;

export const domainApiPaths = {
  /** GET: what we know, and it starts a lookup if there is none yet. POST (owner): look it up now. */
  domain: (businessId: string) => `/api/v1/businesses/${businessId}/domain`,
} as const;
