import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  apiPaths,
  classifyNumberRequestSchema,
  classifyNumberResponseSchema,
  personalNumbersResponseSchema,
  sendWhatsAppRequestSchema,
  pauseBotRequestSchema,
  sendWhatsAppResponseSchema,
  whatsappBotResponseSchema,
  whatsappBotSettingsSchema,
  setStatusRequestSchema,
  showcaseMessages,
  SHOWCASE_VIDEO_MAX_BYTES,
  whatsappInboxResponseSchema,
  whatsappThreadResponseSchema,
  attributionFromMetaReferral,
} from '@leadflow/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { MessengerSender } from '../../integrations/messenger';
import { verifyWebhookSignature, type WhatsAppSender } from '../../integrations/whatsapp';
import { AppError } from '../../lib/errors';
import { requirePermission, tenantOf } from '../../plugins/tenant';
import { WhatsAppService, type InboundMessage } from './service';

declare module 'fastify' {
  interface FastifyRequest {
    /** Exact request body, kept only on the WhatsApp webhook (its signature covers these bytes). */
    rawBody?: string;
  }
}

/** The parts of Meta's webhook payload we use; everything else is ignored. */
const webhookSchema = z.object({
  object: z.string().optional(),
  entry: z
    .array(
      z.object({
        changes: z
          .array(
            z.object({
              field: z.string().optional(),
              value: z
                .object({
                  metadata: z.object({ phone_number_id: z.string().optional() }).optional(),
                  contacts: z
                    .array(
                      z.object({
                        wa_id: z.string().optional(),
                        profile: z.object({ name: z.string().optional() }).optional(),
                      }),
                    )
                    .optional(),
                  messages: z.array(z.record(z.unknown())).optional(),
                  statuses: z
                    .array(z.object({ id: z.string(), status: z.string() }).passthrough())
                    .optional(),
                })
                .passthrough(),
            }),
          )
          .default([]),
      }),
    )
    .default([]),
});

const mediaLabels: Record<string, string> = {
  image: 'תמונה',
  video: 'סרטון',
  audio: 'הודעה קולית',
  voice: 'הודעה קולית',
  document: 'מסמך',
  sticker: 'מדבקה',
  location: 'מיקום',
  contacts: 'איש קשר',
};

/** Text of an incoming message; media shows as "[תמונה] caption" (files aren't downloaded yet). */
function messageText(m: Record<string, unknown>): string {
  const type = String(m.type ?? '');
  const part = (m[type] ?? {}) as Record<string, unknown>;
  if (type === 'text') return String(part.body ?? '');
  if (type === 'button') return String(part.text ?? '');
  if (type === 'interactive') {
    const reply = (part.button_reply ?? part.list_reply) as { title?: string } | undefined;
    return reply?.title ?? '';
  }
  const label = mediaLabels[type];
  if (!label) return '[הודעה מסוג שעדיין לא נתמך]';
  const caption = typeof part.caption === 'string' ? part.caption : '';
  return caption ? `[${label}] ${caption}` : `[${label}]`;
}

/** Id of the tapped button or list row (the booking bot's choices). */
function replyId(m: Record<string, unknown>): string | null {
  if (m.type !== 'interactive') return null;
  const part = (m.interactive ?? {}) as Record<string, unknown>;
  const reply = (part.button_reply ?? part.list_reply) as { id?: unknown } | undefined;
  return typeof reply?.id === 'string' ? reply.id.slice(0, 200) : null;
}

const STATUSES = ['sent', 'delivered', 'read', 'failed'] as const;

/** Keeps the raw text for the signature check (this parser only applies inside the plugin). */
function keepRawJson(app: FastifyInstance) {
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    req.rawBody = body as string;
    try {
      done(null, body === '' ? undefined : JSON.parse(body as string));
    } catch (err) {
      (err as { statusCode?: number }).statusCode = 400;
      done(err as Error, undefined);
    }
  });
}

/** Meta's webhook (F12 POC). Public: Meta calls it; every POST must carry a valid signature. */
export function whatsappWebhookRoutes(sender: WhatsAppSender): FastifyPluginAsyncZod {
  return async (app) => {
    const service = new WhatsAppService(
      app.prisma,
      app.config,
      sender,
      app.log,
      app.storage,
      app.messengerSender,
    );
    const { config } = app;

    keepRawJson(app);

    // Registration handshake: Meta sends the verify token and expects the challenge back.
    app.get(
      apiPaths.whatsapp.webhook,
      {
        schema: {
          querystring: z.object({
            'hub.mode': z.string().optional(),
            'hub.verify_token': z.string().optional(),
            'hub.challenge': z.string().max(200).optional(),
          }),
        },
      },
      async (req, reply) => {
        const q = req.query;
        const ok =
          config.WHATSAPP_VERIFY_TOKEN &&
          q['hub.mode'] === 'subscribe' &&
          q['hub.verify_token'] === config.WHATSAPP_VERIFY_TOKEN;
        if (!ok) throw new AppError('FORBIDDEN');
        return reply.type('text/plain').send(q['hub.challenge'] ?? '');
      },
    );

    app.post(apiPaths.whatsapp.webhook, async (req, reply) => {
      const secret = config.WHATSAPP_APP_SECRET;
      // Which business it's for is decided per message, by the number it was sent to (F25).
      if (!secret) throw new AppError('NOT_FOUND');
      const signature = req.headers['x-hub-signature-256'];
      if (
        !verifyWebhookSignature(
          req.rawBody ?? '',
          typeof signature === 'string' ? signature : undefined,
          secret,
        )
      ) {
        throw new AppError('UNAUTHENTICATED');
      }

      const parsed = webhookSchema.safeParse(req.body);
      if (!parsed.success) return reply.send({ ok: true });
      for (const change of parsed.data.entry.flatMap((e) => e.changes)) {
        const v = change.value;
        // The number it was sent to decides the business (F25); unknown numbers are ignored.
        const numberId = v.metadata?.phone_number_id;
        const names = new Map(
          (v.contacts ?? []).map((c) => [c.wa_id ?? '', c.profile?.name ?? null]),
        );
        for (const m of v.messages ?? []) {
          const from = String(m.from ?? '').replace(/\D/g, '');
          const id = String(m.id ?? '');
          if (!from || !id) continue;
          const seconds = Number(m.timestamp);
          const inbound: InboundMessage = {
            to: numberId,
            waMessageId: id.slice(0, 128),
            from: `+${from}`,
            profileName: names.get(from) ?? null,
            body: messageText(m),
            replyId: replyId(m),
            attribution: adReferral(m.referral),
            receivedAt:
              Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : new Date(),
          };
          await service.receive(inbound);
        }
        for (const s of v.statuses ?? []) {
          const status = STATUSES.find((x) => x === s.status);
          if (status) await service.updateStatus(s.id, status);
        }
      }
      // Meta only needs a 200; anything else makes it retry.
      return reply.send({ ok: true });
    });
  };
}

/** The parts of Messenger's webhook payload we use (F23); everything else is ignored. */
const messengerSchema = z.object({
  object: z.literal('page'),
  entry: z.array(
    z.object({
      id: z.string().optional(),
      messaging: z
        .array(
          z.object({
            sender: z.object({ id: z.string() }),
            recipient: z.object({ id: z.string() }).optional(),
            timestamp: z.number().optional(),
            message: z
              .object({
                mid: z.string(),
                text: z.string().optional(),
                is_echo: z.boolean().optional(),
                attachments: z.array(z.object({ type: z.string().optional() })).optional(),
                referral: z.record(z.unknown()).optional(),
              })
              .optional(),
            referral: z.record(z.unknown()).optional(),
          }),
        )
        .default([]),
    }),
  ),
});

/** F26: Meta's ad referral on a message ("Click to WhatsApp" / Messenger ads), if it's an ad. */
function adReferral(referral: unknown) {
  if (!referral || typeof referral !== 'object') return null;
  return attributionFromMetaReferral(referral as Record<string, unknown>);
}

/** A Messenger message as text: its words, or a label for a photo, video, file… */
function messengerText(m: { text?: string; attachments?: { type?: string }[] }): string {
  if (m.text) return m.text;
  const type = m.attachments?.[0]?.type ?? '';
  const label = mediaLabels[type === 'file' ? 'document' : type];
  return label ? `[${label}]` : '[הודעה מסוג שעדיין לא נתמך]';
}

/**
 * Facebook Messenger's webhook (F23, D-157). Same Meta app as WhatsApp: the same app secret signs
 * every POST and the same verify token answers the handshake. A message to the Page becomes a
 * conversation like a WhatsApp one (inbox → business/personal → lead).
 */
export function messengerWebhookRoutes(
  whatsapp: WhatsAppSender,
  messenger: MessengerSender,
): FastifyPluginAsyncZod {
  return async (app) => {
    const service = new WhatsAppService(
      app.prisma,
      app.config,
      whatsapp,
      app.log,
      app.storage,
      messenger,
    );
    const { config } = app;
    keepRawJson(app);

    app.get(
      apiPaths.whatsapp.messengerWebhook,
      {
        schema: {
          querystring: z.object({
            'hub.mode': z.string().optional(),
            'hub.verify_token': z.string().optional(),
            'hub.challenge': z.string().max(200).optional(),
          }),
        },
      },
      async (req, reply) => {
        const q = req.query;
        const ok =
          config.WHATSAPP_VERIFY_TOKEN &&
          q['hub.mode'] === 'subscribe' &&
          q['hub.verify_token'] === config.WHATSAPP_VERIFY_TOKEN;
        if (!ok) throw new AppError('FORBIDDEN');
        return reply.type('text/plain').send(q['hub.challenge'] ?? '');
      },
    );

    app.post(apiPaths.whatsapp.messengerWebhook, async (req, reply) => {
      const secret = config.WHATSAPP_APP_SECRET;
      if (!secret) throw new AppError('NOT_FOUND');
      const signature = req.headers['x-hub-signature-256'];
      if (
        !verifyWebhookSignature(
          req.rawBody ?? '',
          typeof signature === 'string' ? signature : undefined,
          secret,
        )
      ) {
        throw new AppError('UNAUTHENTICATED');
      }
      const parsed = messengerSchema.safeParse(req.body);
      if (!parsed.success) return reply.send({ ok: true });
      for (const event of parsed.data.entry.flatMap((e) => e.messaging)) {
        const m = event.message;
        // Only customers' messages to our Page (not the Page's own echoes, reads or deliveries).
        if (!m || m.is_echo) continue;
        // The Page it was sent to decides the business (F25); unknown Pages are ignored.
        const psid = event.sender.id.replace(/[^\d]/g, '').slice(0, 40);
        if (!psid) continue;
        await service.receive({
          channel: 'messenger',
          to: event.recipient?.id,
          waMessageId: m.mid.slice(0, 128),
          from: `fb:${psid}`,
          profileName: null,
          body: messengerText(m),
          attribution: adReferral(m.referral ?? event.referral),
          receivedAt: event.timestamp ? new Date(event.timestamp) : new Date(),
        });
      }
      // Meta only needs a 200; anything else makes it retry.
      return reply.send({ ok: true });
    });
  };
}

const leadParams = z.object({ businessId: z.string(), leadId: z.string() });
const params = z.object({ businessId: z.string() });
const numberParams = z.object({ businessId: z.string(), numberId: z.string() });

/**
 * The conversation on a lead and replies; the inbox of unclassified numbers and their
 * classification (D-092). Registered inside the tenant scope.
 */
export function whatsappTenantRoutes(sender: WhatsAppSender): FastifyPluginAsyncZod {
  return async (app) => {
    const service = new WhatsAppService(
      app.prisma,
      app.config,
      sender,
      app.log,
      app.storage,
      app.messengerSender,
    );

    app.get(
      '/leads/:leadId/whatsapp',
      {
        preValidation: requirePermission('leads.view'),
        schema: { params: leadParams, response: { 200: whatsappThreadResponseSchema } },
      },
      async (req) => service.thread(tenantOf(req), req.params.leadId),
    );

    app.post(
      '/leads/:leadId/whatsapp',
      {
        preValidation: requirePermission('leads.update'),
        schema: {
          params: leadParams,
          body: sendWhatsAppRequestSchema,
          response: { 201: sendWhatsAppResponseSchema },
        },
      },
      async (req, reply) =>
        reply.code(201).send({
          message: await service.send(tenantOf(req), req.params.leadId, req.body.text),
        }),
    );

    app.put(
      '/leads/:leadId/whatsapp/bot',
      {
        preValidation: requirePermission('leads.update'),
        schema: { params: leadParams, body: pauseBotRequestSchema },
      },
      async (req, reply) => {
        await service.pauseBot(tenantOf(req), req.params.leadId, req.body.paused);
        return reply.code(204).send();
      },
    );

    app.get(
      '/whatsapp/inbox',
      {
        preValidation: requirePermission('whatsapp.inbox'),
        schema: { params, response: { 200: whatsappInboxResponseSchema } },
      },
      async (req) => service.inbox(tenantOf(req)),
    );

    app.get(
      '/whatsapp/personal',
      {
        preValidation: requirePermission('whatsapp.inbox'),
        schema: { params, response: { 200: personalNumbersResponseSchema } },
      },
      async (req) => service.personalNumbers(tenantOf(req)),
    );

    app.get(
      '/whatsapp/bot',
      {
        preValidation: requirePermission('whatsapp.inbox'),
        schema: { params, response: { 200: whatsappBotResponseSchema } },
      },
      async (req) => service.botSettings(tenantOf(req)),
    );

    app.put(
      '/whatsapp/bot',
      {
        preValidation: requirePermission('whatsapp.inbox'),
        schema: {
          params,
          body: whatsappBotSettingsSchema,
          response: { 200: whatsappBotResponseSchema },
        },
      },
      async (req) => service.updateBotSettings(tenantOf(req), req.body),
    );

    // D-123: the status on now.
    app.put(
      '/whatsapp/status',
      {
        preValidation: requirePermission('whatsapp.inbox'),
        schema: {
          params,
          body: setStatusRequestSchema,
          response: { 200: whatsappBotResponseSchema },
        },
      },
      async (req) => service.setStatus(tenantOf(req), req.body),
    );

    /** The uploaded MP4 (one file, up to WhatsApp's 16 MB). */
    const readVideo = async (req: FastifyRequest) => {
      if (!req.isMultipart()) {
        throw new AppError('VALIDATION_ERROR', showcaseMessages.videoInvalid);
      }
      const file = await req.file({ limits: { fileSize: SHOWCASE_VIDEO_MAX_BYTES, files: 1 } });
      if (!file) throw new AppError('VALIDATION_ERROR', showcaseMessages.videoInvalid);
      const tooLarge = () =>
        new AppError('VALIDATION_ERROR', showcaseMessages.videoTooLarge, {
          video: showcaseMessages.videoTooLarge,
        });
      let video: Buffer;
      try {
        video = await file.toBuffer();
      } catch {
        throw tooLarge();
      }
      if (file.file.truncated) throw tooLarge();
      return video;
    };
    const sendVideo = (reply: FastifyReply, video: Buffer) =>
      reply
        .header('content-type', 'video/mp4')
        .header('cache-control', 'private, no-store')
        .header('x-content-type-options', 'nosniff')
        .send(video);

    // D-151: the "meanwhile" video (one MP4, sent after its photos).
    app.put(
      '/whatsapp/showcase/video',
      {
        preValidation: requirePermission('whatsapp.inbox'),
        schema: { params, response: { 200: whatsappBotResponseSchema } },
      },
      async (req) => service.setShowcaseVideo(tenantOf(req), await readVideo(req)),
    );
    app.get(
      '/whatsapp/showcase/video',
      { preValidation: requirePermission('whatsapp.inbox'), schema: { params } },
      async (req, reply) => sendVideo(reply, await service.showcaseVideo(tenantOf(req))),
    );
    app.delete(
      '/whatsapp/showcase/video',
      {
        preValidation: requirePermission('whatsapp.inbox'),
        schema: { params, response: { 200: whatsappBotResponseSchema } },
      },
      async (req) => service.deleteShowcaseVideo(tenantOf(req)),
    );

    app.post(
      '/whatsapp/numbers/:numberId/classify',
      {
        preValidation: requirePermission('whatsapp.inbox'),
        schema: {
          params: numberParams,
          body: classifyNumberRequestSchema,
          response: { 200: classifyNumberResponseSchema },
        },
      },
      async (req) => service.classify(tenantOf(req), req.params.numberId, req.body.as),
    );

    app.delete(
      '/whatsapp/numbers/:numberId',
      { preValidation: requirePermission('whatsapp.inbox'), schema: { params: numberParams } },
      async (req, reply) => {
        await service.forgetPersonal(tenantOf(req), req.params.numberId);
        return reply.code(204).send();
      },
    );
  };
}
