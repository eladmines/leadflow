import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { FORM_MIN_FILL_MS, FORM_TOKEN_MAX_AGE_MS } from '@leadflow/shared';

/**
 * Per-page-view token for public lead forms: `<issuedAtMs>.<nonce>.<hmac>`.
 * - bound to the subdomain (a token from site A can't be replayed on site B),
 * - proves when the page was served (minimum fill time → simple bot filter, no JavaScript needed),
 * - the nonce is the idempotency key, so a double-submit creates one lead.
 */
const sign = (secret: string, subdomain: string, issuedAt: number, nonce: string) =>
  createHmac('sha256', secret)
    .update(`${subdomain}.${issuedAt}.${nonce}`)
    .digest('base64url')
    .slice(0, 32);

export function createFormToken(secret: string, subdomain: string, now = Date.now()): string {
  const nonce = randomBytes(12).toString('base64url');
  return `${now}.${nonce}.${sign(secret, subdomain, now, nonce)}`;
}

export type FormTokenCheck =
  { ok: true; nonce: string; tooFast: boolean } | { ok: false; reason: 'invalid' | 'expired' };

export function verifyFormToken(
  secret: string,
  subdomain: string,
  token: unknown,
  now = Date.now(),
): FormTokenCheck {
  if (typeof token !== 'string') return { ok: false, reason: 'invalid' };
  const m = /^(\d{13})\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{32})$/.exec(token);
  if (!m) return { ok: false, reason: 'invalid' };
  const issuedAt = Number(m[1]);
  const nonce = m[2]!;
  const expected = Buffer.from(sign(secret, subdomain, issuedAt, nonce));
  const given = Buffer.from(m[3]!);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return { ok: false, reason: 'invalid' };
  }
  const age = now - issuedAt;
  if (age < -60_000 || age > FORM_TOKEN_MAX_AGE_MS) return { ok: false, reason: 'expired' };
  return { ok: true, nonce, tooFast: age < FORM_MIN_FILL_MS };
}
