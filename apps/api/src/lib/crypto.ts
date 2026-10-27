import { createHash, randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';

/**
 * Password hashing: argon2id with the @node-rs/argon2 defaults
 * (m = 19 MiB, t = 2, p = 1 — the OWASP baseline).
 */
export function hashPassword(password: string): Promise<string> {
  return hash(password);
}

/** Returns false (never throws) for a wrong password or a malformed stored hash. */
export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

/**
 * A fixed argon2id hash (same parameters as real hashes) of a random throwaway value.
 * Login verifies against it when the email is unknown, so response timing doesn't reveal
 * whether an account exists.
 */
export const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$yNwPP7VlqzZ8Tx9za2uaKg$T/HrqzvvEjzK+PWWJHKReS/FHV7piTvKzaOPXNFGP/A';

/** 32 random bytes as base64url without padding: always 43 chars (`AUTH_TOKEN_PATTERN`). */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/** SHA-256 as lowercase hex (64 chars). Only token hashes are ever stored. */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
