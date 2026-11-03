import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  apiPaths,
  classifyNumberRequestSchema,
  classifyNumberResponseSchema,
  personalNumbersResponseSchema,
  sendWhatsAppRequestSchema,
  sendWhatsAppResponseSchema,
  whatsappBotResponseSchema,
  whatsappBotSettingsSchema,
  whatsappInboxResponseSchema,
  whatsappThreadResponseSchema,
} from '@leadflow/shared';
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

/** Meta's webhook (F12 POC). Public: Meta calls it; every POST must carry a valid signature. */
export function whatsappWebhookRoutes(sender: WhatsAppSender): FastifyPluginAsyncZod {
  return async (app) => {
    const service = new WhatsAppService(app.prisma, app.config, sender, app.log, app.storage);
    const { config } = app;

    // Keep the raw text for the signature check (this parser only applies inside this plugin).
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
      if (!config.WHATSAPP_BUSINESS_ID || !secret) throw new AppError('NOT_FOUND');
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
        // Only events for our number (the app may have test and real numbers).
        const numberId = v.metadata?.phone_number_id;
        if (config.WHATSAPP_PHONE_NUMBER_ID && numberId !== config.WHATSAPP_PHONE_NUMBER_ID) {
          continue;
        }
        const names = new Map(
          (v.contacts ?? []).map((c) => [c.wa_id ?? '', c.profile?.name ?? null]),
        );
        for (const m of v.messages ?? []) {
          const from = String(m.from ?? '').replace(/\D/g, '');
          const id = String(m.id ?? '');
          if (!from || !id) continue;
          const seconds = Number(m.timestamp);
          const inbound: InboundMessage = {
            waMessageId: id.slice(0, 128),
            from: `+${from}`,
            profileName: names.get(from) ?? null,
            body: messageText(m),
            replyId: replyId(m),
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

const leadParams = z.object({ businessId: z.string(), leadId: z.string() });
const params = z.object({ businessId: z.string() });
const numberParams = z.object({ businessId: z.string(), numberId: z.string() });

/**
 * The conversation on a lead and replies; the inbox of unclassified numbers and their
 * classification (D-092). Registered inside the tenant scope.
 */
export function whatsappTenantRoutes(sender: WhatsAppSender): FastifyPluginAsyncZod {
  return async (app) => {
    const service = new WhatsAppService(app.prisma, app.config, sender, app.log, app.storage);

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
