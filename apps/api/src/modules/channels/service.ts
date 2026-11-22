import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import {
  apiPaths,
  channelsMessages,
  type Channel,
  type ConnectionChannel,
  type ChannelsResponse,
  type ConnectFacebookRequest,
  type ConnectInstagramRequest,
  type ConnectWhatsAppRequest,
  type FacebookPagesResponse,
} from '@simplecatch/shared';
import type { AppConfig } from '../../config/env';
import type { GmailApi } from '../../integrations/gmail';
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
    private readonly gmail: GmailApi,
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
      instagram: one('instagram'),
      gmail: (() => {
        const row = rows.find((r) => r.channel === 'gmail');
        return row
          ? {
              channel: 'email' as const,
              connected: true,
              name: row.displayName,
              source: 'business' as const,
            }
          : { channel: 'email' as const, connected: false, name: null, source: null };
      })(),
      email: one('email'),
      emailInbound: Boolean(this.config.EMAIL_INBOUND_DOMAIN && this.config.EMAIL_INBOUND_SECRET),
      facebookLogin: Boolean(this.config.META_APP_ID),
      gmailLogin: Boolean(this.config.GOOGLE_CLIENT_ID && this.config.GOOGLE_CLIENT_SECRET),
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

  async disconnect(ctx: TenantContext, channel: ConnectionChannel) {
    const row = await this.prisma.channelConnection.findUnique({
      where: { businessId_channel: { businessId: ctx.businessId, channel } },
    });
    if (row && channel === 'gmail') {
      // Tell Google the grant is gone (best effort: the row goes either way).
      await this.gmail
        .revoke(openSecret(row.tokenEncrypted, this.key))
        .catch((err: Error) => this.log.error({ errName: err?.name }, 'gmail revoke failed'));
    }
    if (row) {
      const pageStillUsed =
        channel === 'instagram' &&
        (await this.prisma.channelConnection.count({
          where: { businessId: ctx.businessId, channel: 'messenger' },
        })) > 0;
      if (channel === 'messenger' || (channel === 'instagram' && !pageStillUsed)) {
        // Stop the Page's messages reaching us (best effort: the row goes either way). Instagram
        // shares the Page's subscription, so it stays while Facebook still uses it.
        await this.meta
          .unsubscribePage(row.pageId ?? row.externalId, openSecret(row.tokenEncrypted, this.key))
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
  facebookStart(
    ctx: TenantContext,
    forChannel: 'facebook' | 'instagram' = 'facebook',
  ): { url: string } {
    if (!this.config.META_APP_ID) {
      throw new AppError('CONFLICT', channelsMessages.facebookUnavailable);
    }
    const q = new URLSearchParams({
      client_id: this.config.META_APP_ID,
      redirect_uri: this.redirectUri(),
      state: this.signState({
        b: ctx.businessId,
        u: ctx.userId,
        e: Date.now() + STATE_TTL_MS,
        ...(forChannel === 'instagram' ? { i: 1 } : {}),
      }),
      response_type: 'code',
      ...(this.config.META_LOGIN_CONFIG_ID
        ? { config_id: this.config.META_LOGIN_CONFIG_ID }
        : {
            scope: `pages_show_list,pages_messaging,pages_manage_metadata${
              forChannel === 'instagram' ? ',instagram_basic,instagram_manage_messages' : ''
            }`,
          }),
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
    if (!state || state.g) return `${app}/app`;
    const back = (result: string) =>
      `${app}/b/${state.b}/settings?tab=channels&${state.i ? 'instagram' : 'facebook'}=${encodeURIComponent(result)}`;
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
    return {
      pages: pages.map((p) => ({
        id: p.id,
        name: p.name,
        instagram: p.instagram ? `@${p.instagram.username}` : null,
      })),
    };
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

  /**
   * F28: connects Instagram. With a picked Page (after sign-in) its linked account; with nothing,
   * the account linked to the Facebook Page this business already connected. Messages arrive on the
   * Page's subscription, and replies use the Page's token (kept sealed).
   */
  async connectInstagram(ctx: TenantContext, input: ConnectInstagramRequest) {
    let page: { id: string; token: string; instagram: { id: string; username: string } | null };
    if (input.pendingId && input.pageId) {
      const picked = (await this.pendingPages(ctx, input.pendingId)).find(
        (p) => p.id === input.pageId,
      );
      if (!picked) throw new AppError('CONFLICT', channelsMessages.facebookExpired);
      page = {
        id: picked.id,
        token: picked.accessToken,
        instagram: picked.instagram ?? null,
      };
    } else {
      const row = await this.prisma.channelConnection.findUnique({
        where: { businessId_channel: { businessId: ctx.businessId, channel: 'messenger' } },
      });
      if (!row) throw new AppError('CONFLICT', channelsMessages.instagramFailed);
      const token = openSecret(row.tokenEncrypted, this.key);
      page = {
        id: row.externalId,
        token,
        instagram: await this.meta.instagramOf(row.externalId, token),
      };
    }
    if (!page.instagram) throw new AppError('CONFLICT', channelsMessages.instagramNoAccount);
    await this.assertFree(ctx, 'instagram', page.instagram.id);
    try {
      await this.meta.subscribePage(page.id, page.token);
    } catch (err) {
      this.log.error({ errName: (err as Error)?.name }, 'instagram subscribe failed');
      throw new AppError('CONFLICT', channelsMessages.instagramFailed);
    }
    await this.save(ctx, 'instagram', {
      externalId: page.instagram.id,
      displayName: `@${page.instagram.username}`,
      token: page.token,
      pageId: page.id,
    });
    if (input.pendingId) {
      await this.prisma.oAuthPending.deleteMany({
        where: { OR: [{ id: input.pendingId }, { expiresAt: { lt: new Date() } }] },
      });
    }
    return this.status(ctx);
  }

  // ------------------------------------------------------------------ Gmail sign-in (F29)

  private gmailRedirectUri() {
    return `${new URL(this.config.APP_URL).origin}${apiPaths.channels.gmailCallback}`;
  }

  /** Where to send the person: Google's consent screen, coming back with a signed state. */
  gmailStart(ctx: TenantContext): { url: string } {
    if (!this.config.GOOGLE_CLIENT_ID || !this.config.GOOGLE_CLIENT_SECRET) {
      throw new AppError('CONFLICT', channelsMessages.gmailUnavailable);
    }
    const state = this.signState({
      b: ctx.businessId,
      u: ctx.userId,
      e: Date.now() + STATE_TTL_MS,
      g: 1,
    });
    return { url: this.gmail.authUrl(this.gmailRedirectUri(), state) };
  }

  /**
   * Google sends the person back here. The inbox is connected on the spot (one account, nothing to
   * choose); only mail that arrives from now on is imported. The answer is where to send the browser.
   */
  async gmailCallback(q: { code?: string; state?: string; error?: string }): Promise<string> {
    const state = this.readState(q.state);
    const app = new URL(this.config.APP_URL).origin;
    if (!state || !state.g) return `${app}/app`;
    const back = (result: string) =>
      `${app}/b/${state.b}/settings?tab=channels&gmail=${encodeURIComponent(result)}`;
    if (q.error || !q.code) return back('cancelled');
    try {
      const tokens = await this.gmail.exchangeCode(q.code, this.gmailRedirectUri());
      const taken = await this.prisma.channelConnection.findUnique({
        where: { channel_externalId: { channel: 'gmail', externalId: tokens.email } },
        select: { businessId: true },
      });
      if (taken && taken.businessId !== state.b) return back('taken');
      const data = {
        externalId: tokens.email,
        displayName: tokens.email,
        tokenEncrypted: sealSecret(tokens.refreshToken, this.key),
        connectedById: state.u,
        // Nothing before this moment is imported.
        syncCursor: BigInt(Date.now()),
      };
      await this.prisma.$transaction(async (tx) => {
        const row = await tx.channelConnection.upsert({
          where: { businessId_channel: { businessId: state.b, channel: 'gmail' } },
          create: { businessId: state.b, channel: 'gmail', ...data },
          update: data,
        });
        await recordAudit(tx, {
          action: 'channel.connected',
          businessId: state.b,
          actorUserId: state.u,
          entityType: 'channel_connection',
          entityId: row.id,
          metadata: { channel: 'gmail' },
        });
      });
    } catch (err) {
      // Google's HTTP status only (never its text or any token): enough to tell a wrong secret
      // (401) from a disabled API or redirect mismatch (400/403).
      this.log.error(
        { errName: (err as Error)?.name, status: (err as { status?: number })?.status },
        'gmail sign-in failed',
      );
      return back('error');
    }
    return back('connected');
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
    c: { externalId: string; displayName: string; token: string; pageId?: string },
  ) {
    await this.assertFree(ctx, channel, c.externalId);
    const data = {
      externalId: c.externalId,
      displayName: c.displayName.slice(0, 120),
      tokenEncrypted: sealSecret(c.token, this.key),
      pageId: c.pageId ?? null,
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

  private signState(payload: { b: string; u: string; e: number; i?: 1; g?: 1 }) {
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
        i?: unknown;
        g?: unknown;
      };
      if (typeof p.b !== 'string' || typeof p.u !== 'string' || typeof p.e !== 'number')
        return null;
      return p.e > Date.now() ? { b: p.b, u: p.u, i: p.i === 1, g: p.g === 1 } : null;
    } catch {
      return null;
    }
  }
}
