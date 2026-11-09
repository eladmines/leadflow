import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  conversationListQuerySchema,
  conversationListResponseSchema,
  conversationResponseSchema,
  sendWhatsAppRequestSchema,
  sendWhatsAppResponseSchema,
  unreadConversationsResponseSchema,
} from '@leadflow/shared';
import { requirePermission, tenantOf } from '../../plugins/tenant';
import { WhatsAppService } from '../whatsapp/service';
import { ConversationService } from './service';

const params = z.object({ businessId: z.string(), conversationId: z.string() });

/** F24 unified inbox (D-158): owners and managers, like the WhatsApp inbox before it. */
export const conversationTenantRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = new ConversationService(
    app.prisma,
    new WhatsAppService(
      app.prisma,
      app.config,
      app.whatsappSender,
      app.log,
      app.storage,
      app.messengerSender,
    ),
  );
  const guard = requirePermission('whatsapp.inbox');

  app.get(
    '/conversations',
    {
      preValidation: guard,
      schema: {
        querystring: conversationListQuerySchema,
        response: { 200: conversationListResponseSchema },
      },
    },
    async (req) => service.list(tenantOf(req), req.query),
  );

  app.get(
    '/conversations/unread',
    { preValidation: guard, schema: { response: { 200: unreadConversationsResponseSchema } } },
    async (req) => ({ unreadCount: await service.unreadCount(tenantOf(req)) }),
  );

  app.get(
    '/conversations/:conversationId',
    { preValidation: guard, schema: { params, response: { 200: conversationResponseSchema } } },
    async (req) => service.detail(tenantOf(req), req.params.conversationId),
  );

  app.post(
    '/conversations/:conversationId/read',
    { preValidation: guard, schema: { params } },
    async (req, reply) => {
      await service.markRead(tenantOf(req), req.params.conversationId);
      return reply.code(204).send();
    },
  );

  app.post(
    '/conversations/:conversationId/messages',
    {
      preValidation: guard,
      schema: {
        params,
        body: sendWhatsAppRequestSchema,
        response: { 201: sendWhatsAppResponseSchema },
      },
    },
    async (req, reply) => {
      const { message } = await service.send(
        tenantOf(req),
        req.params.conversationId,
        req.body.text,
      );
      return reply.code(201).send({ message });
    },
  );
};
