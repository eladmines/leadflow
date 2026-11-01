import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  markNotificationsReadRequestSchema,
  notificationListResponseSchema,
} from '@leadflow/shared';
import { requirePermission, tenantOf } from '../../plugins/tenant';
import { NotificationService } from './service';

const params = z.object({ businessId: z.string() });

/** The caller's own notifications (D-097). Registered inside the tenant scope. */
export const notificationTenantRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = new NotificationService(app.prisma);

  app.get(
    '/notifications',
    {
      preValidation: requirePermission('business.view'),
      schema: { params, response: { 200: notificationListResponseSchema } },
    },
    async (req) => service.list(tenantOf(req)),
  );

  app.post(
    '/notifications/read',
    {
      preValidation: requirePermission('business.view'),
      schema: { params, body: markNotificationsReadRequestSchema },
    },
    async (req, reply) => {
      await service.markRead(tenantOf(req), req.body.ids);
      return reply.code(204).send();
    },
  );
};
