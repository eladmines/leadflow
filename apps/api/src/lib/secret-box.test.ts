import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { openSecret, sealSecret, secretKey } from './secret-box';

describe('secret box (F25)', () => {
  const key = randomBytes(32);

  it('seals and opens; the box never contains the secret', () => {
    const box = sealSecret('EAA-page-token-123', key);
    expect(box).toMatch(/^v1\./);
    expect(box).not.toContain('EAA-page-token-123');
    expect(openSecret(box, key)).toBe('EAA-page-token-123');
    // A new IV every time.
    expect(sealSecret('EAA-page-token-123', key)).not.toBe(box);
  });

  it('refuses a tampered box or another key', () => {
    const box = sealSecret('secret', key);
    const parts = box.split('.');
    parts[3] = Buffer.from('x').toString('base64url');
    expect(() => openSecret(parts.join('.'), key)).toThrow();
    expect(() => openSecret(box, randomBytes(32))).toThrow();
  });

  it('uses CHANNEL_SECRETS_KEY when set, else a key derived from the form secret', () => {
    const explicit = randomBytes(32).toString('base64');
    expect(secretKey({ CHANNEL_SECRETS_KEY: explicit, FORM_TOKEN_SECRET: 'x'.repeat(32) })).toEqual(
      Buffer.from(explicit, 'base64'),
    );
    const derived = secretKey({
      CHANNEL_SECRETS_KEY: undefined,
      FORM_TOKEN_SECRET: 'x'.repeat(32),
    });
    expect(derived).toHaveLength(32);
  });
});
