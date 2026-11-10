import type { PrismaClient } from '@prisma/client';
import type { Channel } from '@leadflow/shared';
import type { AppConfig } from '../../config/env';
import { CloudMessengerSender, type MessengerSender } from '../../integrations/messenger';
import { CloudWhatsAppSender, type WhatsAppSender } from '../../integrations/whatsapp';
import { openSecret, secretKey } from '../../lib/secret-box';

/**
 * F25 (D-159): which business owns a WhatsApp number or Facebook Page, and how to send for it.
 * Each business's own connection (database, token encrypted) comes first; the single connection
 * in the environment (F12/F23 POC) keeps working as a fallback. With the `local` providers the
 * in-memory senders stand in for Meta (development and tests).
 */
export class ChannelRegistry {
  private readonly key: Buffer;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: AppConfig,
    /** The environment's (or a test's) senders. */
    private readonly envWhatsApp: WhatsAppSender,
    private readonly envMessenger: MessengerSender,
  ) {
    this.key = secretKey(config);
  }

  private connection(channel: Channel, where: { businessId: string } | { externalId: string }) {
    return this.prisma.channelConnection.findFirst({ where: { channel, ...where } });
  }

  /** The business for an incoming message, by Meta's phone number id or Page id. */
  async businessFor(channel: Channel, externalId: string | undefined): Promise<string | null> {
    if (externalId) {
      const row = await this.connection(channel, { externalId });
      if (row) return row.businessId;
    }
    const c = this.config;
    // Email has no environment fallback: only addresses a business created (F27).
    if (channel === 'email') return null;
    if (channel === 'whatsapp') {
      if (!c.WHATSAPP_BUSINESS_ID) return null;
      return !c.WHATSAPP_PHONE_NUMBER_ID || c.WHATSAPP_PHONE_NUMBER_ID === externalId
        ? c.WHATSAPP_BUSINESS_ID
        : null;
    }
    if (!c.MESSENGER_BUSINESS_ID) return null;
    return !c.MESSENGER_PAGE_ID || c.MESSENGER_PAGE_ID === externalId
      ? c.MESSENGER_BUSINESS_ID
      : null;
  }

  async whatsapp(businessId: string): Promise<WhatsAppSender | null> {
    const row = await this.connection('whatsapp', { businessId });
    if (row) {
      return this.config.WHATSAPP_PROVIDER === 'cloud'
        ? new CloudWhatsAppSender({
            phoneNumberId: row.externalId,
            accessToken: openSecret(row.tokenEncrypted, this.key),
            graphVersion: this.config.WHATSAPP_GRAPH_VERSION,
          })
        : this.envWhatsApp;
    }
    return this.config.WHATSAPP_BUSINESS_ID === businessId ? this.envWhatsApp : null;
  }

  async messenger(businessId: string): Promise<MessengerSender | null> {
    const row = await this.connection('messenger', { businessId });
    if (row) {
      return this.config.MESSENGER_PROVIDER === 'cloud'
        ? new CloudMessengerSender({
            pageId: row.externalId,
            pageAccessToken: openSecret(row.tokenEncrypted, this.key),
            graphVersion: this.config.WHATSAPP_GRAPH_VERSION,
          })
        : this.envMessenger;
    }
    return this.config.MESSENGER_BUSINESS_ID === businessId ? this.envMessenger : null;
  }

  /** The business's forwarding address (F27), or null. */
  async emailAddress(businessId: string): Promise<string | null> {
    return (await this.connection('email', { businessId }))?.externalId ?? null;
  }

  async isConnected(businessId: string, channel?: Channel): Promise<boolean> {
    const channels: Channel[] = channel ? [channel] : ['whatsapp', 'messenger', 'email'];
    for (const ch of channels) {
      if (ch === 'whatsapp' && this.config.WHATSAPP_BUSINESS_ID === businessId) return true;
      if (ch === 'messenger' && this.config.MESSENGER_BUSINESS_ID === businessId) return true;
    }
    const n = await this.prisma.channelConnection.count({
      where: { businessId, channel: { in: channels } },
    });
    return n > 0;
  }
}
