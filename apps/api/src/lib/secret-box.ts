import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { AppConfig } from '../config/env';

/**
 * Encrypts secrets kept in the database (F25: channel access tokens) with AES-256-GCM.
 * Stored as `v1.<iv>.<tag>.<ciphertext>` (base64url). The key is `CHANNEL_SECRETS_KEY`
 * (32 bytes, base64), or one derived from `FORM_TOKEN_SECRET` when it isn't set.
 */
export function secretKey(config: Pick<AppConfig, 'CHANNEL_SECRETS_KEY' | 'FORM_TOKEN_SECRET'>) {
  if (config.CHANNEL_SECRETS_KEY) return Buffer.from(config.CHANNEL_SECRETS_KEY, 'base64');
  return createHash('sha256')
    .update(`leadflow-channel-secrets:${config.FORM_TOKEN_SECRET}`)
    .digest();
}

export function sealSecret(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv, tag, data]
    .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
    .join('.');
}

/** Throws when the box was tampered with or sealed with another key. */
export function openSecret(box: string, key: Buffer): string {
  const [version, iv, tag, data] = box.split('.');
  if (version !== 'v1' || !iv || !tag || !data) throw new Error('Unknown secret format');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(data, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
