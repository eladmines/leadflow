import { createHmac, timingSafeEqual } from 'node:crypto';
import type { AppConfig } from '../../config/env';
import { CloudWhatsAppSender } from './cloud';
import { MemoryWhatsAppSender } from './memory';
import type { WhatsAppSender } from './types';

export type { WhatsAppChoice, WhatsAppSender } from './types';
export { MemoryWhatsAppSender } from './memory';
export { CloudWhatsAppSender, WhatsAppSendError } from './cloud';

/** Picks the adapter from `WHATSAPP_PROVIDER`. */
export function createWhatsAppSender(config: AppConfig): WhatsAppSender {
  if (config.WHATSAPP_PROVIDER === 'cloud') {
    return new CloudWhatsAppSender({
      phoneNumberId: config.WHATSAPP_PHONE_NUMBER_ID!,
      accessToken: config.WHATSAPP_ACCESS_TOKEN!,
      graphVersion: config.WHATSAPP_GRAPH_VERSION,
    });
  }
  return new MemoryWhatsAppSender();
}

/** `sha256=<hex>` HMAC of the raw request body with the app secret (Meta's webhook signature). */
export function signWebhookBody(rawBody: string, appSecret: string): string {
  return `sha256=${createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex')}`;
}

export function verifyWebhookSignature(
  rawBody: string,
  header: string | undefined,
  appSecret: string,
): boolean {
  if (!header) return false;
  const expected = Buffer.from(signWebhookBody(rawBody, appSecret));
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
