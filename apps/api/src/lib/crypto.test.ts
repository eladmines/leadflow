import { describe, expect, it } from 'vitest';
import { AUTH_TOKEN_PATTERN } from '@leadflow/shared';
import {
  DUMMY_PASSWORD_HASH,
  generateToken,
  hashPassword,
  sha256Hex,
  verifyPassword,
} from './crypto';

describe('crypto', () => {
  it('hashes passwords with argon2id and verifies them', async () => {
    const h = await hashPassword('correct horse battery');
    expect(h).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(h, 'correct horse battery')).toBe(true);
    expect(await verifyPassword(h, 'wrong password!')).toBe(false);
  });

  it('never throws on a malformed hash', async () => {
    expect(await verifyPassword('not-a-hash', 'whatever')).toBe(false);
  });

  it('has a dummy hash with the same parameters as real hashes', async () => {
    const real = await hashPassword('x'.repeat(12));
    const params = (s: string) => s.split('$').slice(1, 4).join('$');
    expect(params(DUMMY_PASSWORD_HASH)).toBe(params(real));
    expect(await verifyPassword(DUMMY_PASSWORD_HASH, 'anything')).toBe(false);
  });

  it('generates unique 43-char base64url tokens', () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).toMatch(AUTH_TOKEN_PATTERN);
    expect(b).toMatch(AUTH_TOKEN_PATTERN);
    expect(a).not.toBe(b);
  });

  it('computes sha256 hex', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});
