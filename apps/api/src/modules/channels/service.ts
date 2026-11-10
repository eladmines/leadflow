import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import {
  apiPaths,
  channelsMessages,
  type Channel,
  type ChannelsResponse,
  type ConnectFacebookRequest,
  type ConnectWhatsAppRequest,
  type FacebookPagesResponse,
} from '@leadflow/shared';
import type { AppConfig } from '../../config/env';
import type { MetaApi, MetaPage } from '../../integrations/meta';
import { AppError } from '../../lib/errors';
import { openSecret, sealSecret, secretKey } from '../../lib/secret-box';
import type { TenantContext } from '../../plugins/tenant';
import { recordAudit } from '../audit/service';

/** Facebook sign-in must come back within this time. */
const STATE_TTL_MS = 15 * 60_000;

interface Log {
  error: (obj: object, msg: string) => void;
}

/**
 * F25 (D-159): each business connects its own WhatsApp number and Facebook Page. Tokens are
 * sealed (AES-256-GCM) before they're stored and never leave the server. A number or Page belongs
 * to one business. The environment's single connection (F12/F23) still shows as "system".
 */
export class ChannelService {
  private readonly key: Buffer;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: AppConfig,
    private readonly meta: MetaApi,
    private readonly log: Log,
  ) {
    this.key = secretKey(config);
  }

  async status(ctx: TenantContext): Promise<ChannelsResponse> {
    const rows = await this.prisma.channelConnection.findMany({
      where: { businessId: ctx.businessId },
      select: { channel: true, displayName: true },
    });
    const one = (channel: Channel) => {
      const row = rows.find((r) => r.channel === channel);
      if (row)
        return { channel, connected: true, name: row.displayName, source: 'business' as const };
      const env =
        channel === 'whatsapp'
          ? this.config.WHATSAPP_BUSINESS_ID
          : channel === 'messenger'
            ? this.config.MESSENGER_BUSINESS_ID
            : undefined;
      return env === ctx.businessId
        ? { channel, connected: true, name: null, source: 'environment' as const }
        : { channel, connected: false, name: null, source: null };
    };
    return {
      whatsapp: one('whatsapp'),
      messenger: one('messenger'),
      email: one('email'),
      emailInbound: Boolean(this.config.EMAIL_INBOUND_DOMAIN && this.config.EMAIL_INBOUND_SECRET),
      facebookLogin: Boolean(this.config.META_APP_ID),
    };
  }

  /** WhatsApp with Meta's "Phone number ID" and an access token, checked against Meta first. */
  async connectWhatsApp(ctx: TenantContext, input: ConnectWhatsAppRequest) {
    const found = await this.meta.whatsappNumber(input.phoneNumberId, input.accessToken);
    const local = this.config.WHATSAPP_PROVIDER !== 'cloud';
    if (!found && !local) {
      throw new AppError('VALIDATION_ERROR', channelsMessages.whatsappInvalid, {
        accessToken: channelsMessages.whatsappInvalid,
      });
    }
    await this.save(ctx, 'whatsapp', {
      externalId: input.phoneNumberId,
      displayName: found ?? input.phoneNumberId,
      token: input.accessToken,
    });
    return this.status(ctx);
  }

  /**
   * F27: the business's forwarding address, `<random>@<EMAIL_INBOUND_DOMAIN>`. Creating it again
   * returns the same one. The random part is the only secret: it isn't derived from anything.
   */
  async createEmailAddress(ctx: TenantContext) {
    const domain = this.config.EMAIL_INBOUND_DOMAIN;
    if (!domain || !this.config.EMAIL_INBOUND_SECRET) {
      throw new AppError('CONFLICT', channelsMessages.emailUnavailable);
    }
    const existing = await this.prisma.channelConnection.findUnique({
      where: { businessId_channel: { businessId: ctx.businessId, channel: 'email' } },
    });
    if (existing) return this.status(ctx);
    const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
    const slug = Array.from({ length: 10 }, () => alphabet[randomInt(alphabet.length)]).join('');
    const address = `${slug}@${domain}`;
    await this.save(ctx, 'email', { externalId: address, displayName: address, token: '-' });
    return this.status(ctx);
  }

  async disconnect(ctx: TenantContext, channel: Channel) {
    const row = await this.prisma.channelConnection.findUnique({
      where: { businessId_channel: { businessId: ctx.businessId, channel } },
    });
    if (row) {
      if (channel === 'messenger') {
        // Stop the Page's messages reaching us (best effort: the row goes either way).
        await this.meta
          .unsubscribePage(row.externalId, openSecret(row.tokenEncrypted, this.key))
          .catch((err: Error) =>
            this.log.error({ errName: err?.name }, 'facebook unsubscribe failed'),
          );
      }
      await this.prisma.$transaction(async (tx) => {
        await tx.channelConnection.delete({ where: { id: row.id } });
        await recordAudit(tx, {
          action: 'channel.disconnected',
          businessId: ctx.businessId,
          actorUserId: ctx.userId,
          entityType: 'channel_connection',
          entityId: row.id,
          metadata: { channel },
        });
      });
    }
    return this.status(ctx);
  }

  // ------------------------------------------------------------------ Facebook sign-in

  private redirectUri() {
    return `${new URL(this.config.APP_URL).origin}${apiPaths.channels.facebookCallback}`;
  }

  /** Where to send the person: Facebook's sign-in, coming back with a signed state. */
  facebookStart(ctx: TenantContext): { url: string } {
    if (!this.config.META_APP_ID) {
      throw new AppError('CONFLICT', channelsMessages.facebookUnavailable);
    }
    const q = new URLSearchParams({
      client_id: this.config.META_APP_ID,
      redirect_uri: this.redirectUri(),
      state: this.signState({ b: ctx.businessId, u: ctx.userId, e: Date.now() + STATE_TTL_MS }),
      response_type: 'code',
      ...(this.config.META_LOGIN_CONFIG_ID
        ? { config_id: this.config.META_LOGIN_CONFIG_ID }
        : { scope: 'pages_show_list,pages_messaging,pages_manage_metadata' }),
    });
    return {
      url: `https://www.facebook.com/${this.config.WHATSAPP_GRAPH_VERSION}/dialog/oauth?${q}`,
    };
  }

  /**
   * Facebook sends the person back here. Their Pages (with tokens, sealed) wait 15 minutes for
   * them to pick one; the answer is where to send the browser next.
   */
  async facebookCallback(q: { code?: string; state?: string; error?: string }): Promise<string> {
    const state = this.readState(q.state);
    const app = new URL(this.config.APP_URL).origin;
    if (!state) return `${app}/app`;
    const back = (result: string) =>
      `${app}/b/${state.b}/settings?tab=channels&facebook=${encodeURIComponent(result)}`;
    if (q.error || !q.code) return back('cancelled');
    let pages: MetaPage[];
    try {
      const userToken = await this.meta.exchangeCode(q.code, this.redirectUri());
      pages = await this.meta.pages(userToken);
    } catch (err) {
      this.log.error({ errName: (err as Error)?.name }, 'facebook sign-in failed');
      return back('error');
    }
    if (pages.length === 0) return back('no-pages');
    const pending = await this.prisma.oAuthPending.create({
      data: {
        businessId: state.b,
        userId: state.u,
        dataEncrypted: sealSecret(JSON.stringify(pages), this.key),
        expiresAt: new Date(Date.now() + STATE_TTL_MS),
      },
    });
    return back(pending.id);
  }

  private async pendingPages(ctx: TenantContext, pendingId: string): Promise<MetaPage[]> {
    const row = await this.prisma.oAuthPending.findFirst({
      where: {
        id: pendingId,
        businessId: ctx.businessId,
        userId: ctx.userId,
        expiresAt: { gt: new Date() },
      },
    });
    if (!row) throw new AppError('CONFLICT', channelsMessages.facebookExpired);
    return JSON.parse(openSecret(row.dataEncrypted, this.key)) as MetaPage[];
  }

  async facebookPages(ctx: TenantContext, pendingId: string): Promise<FacebookPagesResponse> {
    const pages = await this.pendingPages(ctx, pendingId);
    return { pages: pages.map((p) => ({ id: p.id, name: p.name })) };
  }

  /** Connects the chosen Page: its messages are sent to us, and its token is kept sealed. */
  async connectFacebook(ctx: TenantContext, input: ConnectFacebookRequest) {
    const page = (await this.pendingPages(ctx, input.pendingId)).find((p) => p.id === input.pageId);
    if (!page) throw new AppError('CONFLICT', channelsMessages.facebookExpired);
    await this.assertFree(ctx, 'messenger', page.id);
    try {
      await this.meta.subscribePage(page.id, page.accessToken);
    } catch (err) {
      this.log.error({ errName: (err as Error)?.name }, 'facebook subscribe failed');
      throw new AppError('CONFLICT', channelsMessages.facebookFailed);
    }
    await this.save(ctx, 'messenger', {
      externalId: page.id,
      displayName: page.name,
      token: page.accessToken,
    });
    await this.prisma.oAuthPending.deleteMany({
      where: { OR: [{ id: input.pendingId }, { expiresAt: { lt: new Date() } }] },
    });
    return this.status(ctx);
  }

  // ------------------------------------------------------------------ helpers

  private async assertFree(ctx: TenantContext, channel: Channel, externalId: string) {
    const taken = await this.prisma.channelConnection.findUnique({
      where: { channel_externalId: { channel, externalId } },
      select: { businessId: true },
    });
    if (taken && taken.businessId !== ctx.businessId) {
      throw new AppError('CONFLICT', channelsMessages.alreadyTaken);
    }
  }

  private async save(
    ctx: TenantContext,
    channel: Channel,
    c: { externalId: string; displayName: string; token: string },
  ) {
    await this.assertFree(ctx, channel, c.externalId);
    const data = {
      externalId: c.externalId,
      displayName: c.displayName.slice(0, 120),
      tokenEncrypted: sealSecret(c.token, this.key),
      connectedById: ctx.userId,
    };
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.channelConnection.upsert({
        where: { businessId_channel: { businessId: ctx.businessId, channel } },
        create: { businessId: ctx.businessId, channel, ...data },
        update: data,
      });
      await recordAudit(tx, {
        action: 'channel.connected',
        businessId: ctx.businessId,
        actorUserId: ctx.userId,
        entityType: 'channel_connection',
        entityId: row.id,
        metadata: { channel },
      });
    });
  }

  private signState(payload: { b: string; u: string; e: number }) {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${body}.${createHmac('sha256', this.key).update(body).digest('base64url')}`;
  }

  private readState(state: string | undefined) {
    if (!state) return null;
    const [body, sig] = state.split('.');
    if (!body || !sig) return null;
    const expected = createHmac('sha256', this.key).update(body).digest('base64url');
    if (
      sig.length !== expected.length ||
      !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
    ) {
      return null;
    }
    try {
      const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as {
        b?: unknown;
        u?: unknown;
        e?: unknown;
      };
      if (typeof p.b !== 'string' || typeof p.u !== 'string' || typeof p.e !== 'number')
        return null;
      return p.e > Date.now() ? { b: p.b, u: p.u } : null;
    } catch {
      return null;
    }
  }
}
