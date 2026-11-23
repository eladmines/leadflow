import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * F30: a business's public embed key = `<business id without dashes>.<hmac>`. Stateless (no column,
 * no migration); signed with FORM_TOKEN_SECRET, so it can't be guessed for another business.
 * It is public (it sits in the site's HTML) and only lets leads in.
 */
const sign = (secret: string, id: string) =>
  createHmac('sha256', secret).update(`embed.${id}`).digest('base64url').slice(0, 22);

export const createEmbedKey = (secret: string, businessId: string) => {
  const id = businessId.replace(/-/g, '');
  return `${id}.${sign(secret, id)}`;
};

/** The business id inside a valid key, or null. */
export function readEmbedKey(secret: string, key: unknown): string | null {
  if (typeof key !== 'string') return null;
  const m = /^([0-9a-f]{32})\.([A-Za-z0-9_-]{22})$/.exec(key);
  if (!m) return null;
  const expected = Buffer.from(sign(secret, m[1]!));
  const given = Buffer.from(m[2]!);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const h = m[1]!;
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
