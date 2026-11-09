import type { FastifyPluginAsync } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  apiPaths,
  channelsResponseSchema,
  connectFacebookRequestSchema,
  connectWhatsAppRequestSchema,
  facebookPagesResponseSchema,
  facebookStartResponseSchema,
} from '@leadflow/shared';
import { requirePermission, tenantOf } from '../../plugins/tenant';
import { ChannelService } from './service';

const service = (app: Parameters<FastifyPluginAsync>[0]) =>
  new ChannelService(app.prisma, app.config, app.metaApi, app.log);

/** F25 (D-159): Settings → Channels. Everyone sees the status; only the owner connects. */
export const channelTenantRoutes: FastifyPluginAsyncZod = async (app) => {
  const channels = service(app);
  const owner = requirePermission('business.update');

  app.get(
    '/channels',
    {
      preValidation: requirePermission('business.view'),
      schema: { response: { 200: channelsResponseSchema } },
    },
    async (req) => channels.status(tenantOf(req)),
  );

  app.post(
    '/channels/whatsapp',
    {
      preValidation: owner,
      schema: { body: connectWhatsAppRequestSchema, response: { 200: channelsResponseSchema } },
    },
    async (req) => channels.connectWhatsApp(tenantOf(req), req.body),
  );

  app.get(
    '/channels/facebook/start',
    { preValidation: owner, schema: { response: { 200: facebookStartResponseSchema } } },
    async (req) => channels.facebookStart(tenantOf(req)),
  );

  app.get(
    '/channels/facebook/pending/:pendingId',
    {
      preValidation: owner,
      schema: {
        params: z.object({ businessId: z.string(), pendingId: z.string().uuid() }),
        response: { 200: facebookPagesResponseSchema },
      },
    },
    async (req) => channels.facebookPages(tenantOf(req), req.params.pendingId),
  );

  app.post(
    '/channels/facebook',
    {
      preValidation: owner,
      schema: { body: connectFacebookRequestSchema, response: { 200: channelsResponseSchema } },
    },
    async (req) => channels.connectFacebook(tenantOf(req), req.body),
  );

  app.delete(
    '/channels/:channel',
    {
      preValidation: owner,
      schema: {
        params: z.object({ businessId: z.string(), channel: z.enum(['whatsapp', 'messenger']) }),
        response: { 200: channelsResponseSchema },
      },
    },
    async (req) => channels.disconnect(tenantOf(req), req.params.channel),
  );
};

/** Facebook sends the person back here after sign-in; the signed state says for which business. */
export const channelPublicRoutes: FastifyPluginAsyncZod = async (app) => {
  const channels = service(app);
  app.get(
    apiPaths.channels.facebookCallback,
    {
      schema: {
        querystring: z.object({
          code: z.string().max(2000).optional(),
          state: z.string().max(2000).optional(),
          error: z.string().max(200).optional(),
        }),
      },
    },
    async (req, reply) => reply.redirect(await channels.facebookCallback(req.query)),
  );
};
