import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  apiPaths,
  businessListResponseSchema,
  businessResponseSchema,
  createBusinessRequestSchema,
  memberListResponseSchema,
  notificationPrefsResponseSchema,
  notificationPrefsSchema,
  updateBusinessRequestSchema,
} from '@leadflow/shared';
import { authOf, requireAuth } from '../../plugins/session';
import { requirePermission, tenantOf } from '../../plugins/tenant';
import { BusinessService } from './service';

const paths = apiPaths.businesses;
const tenantParams = z.object({ businessId: z.string() });

/** Non-tenant routes: the caller's own businesses, and creating a new one. */
export const businessRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = new BusinessService(app.prisma, app.log);

  app.get(
    paths.list,
    { preValidation: requireAuth, schema: { response: { 200: businessListResponseSchema } } },
    async (req) => ({ businesses: await service.listMine(authOf(req).user.id) }),
  );

  app.post(
    paths.create,
    {
      preValidation: requireAuth,
      schema: { body: createBusinessRequestSchema, response: { 201: businessResponseSchema } },
    },
    async (req, reply) => {
      const business = await service.create(authOf(req).user.id, req.body);
      return reply.status(201).send({ business });
    },
  );
};

/** Tenant routes (`/api/v1/businesses/:businessId/...`); registered inside the tenant scope. */
export const businessTenantRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = new BusinessService(app.prisma, app.log);
  {
    app.get(
      '',
      {
        preValidation: requirePermission('business.view'),
        schema: { params: tenantParams, response: { 200: businessResponseSchema } },
      },
      async (req) => ({ business: await service.get(tenantOf(req)) }),
    );

    app.patch(
      '',
      {
        preValidation: requirePermission('business.update'),
        schema: {
          params: tenantParams,
          body: updateBusinessRequestSchema,
          response: { 200: businessResponseSchema },
        },
      },
      async (req) => ({ business: await service.update(tenantOf(req), req.body) }),
    );

    app.post(
      '/onboarding/complete',
      {
        preValidation: requirePermission('business.update'),
        schema: { params: tenantParams, response: { 200: businessResponseSchema } },
      },
      async (req) => ({ business: await service.completeOnboarding(tenantOf(req)) }),
    );

    app.get(
      '/members',
      {
        preValidation: requirePermission('members.view'),
        schema: { params: tenantParams, response: { 200: memberListResponseSchema } },
      },
      async (req) => ({ members: await service.listMembers(tenantOf(req)) }),
    );

    // Every member manages only their own preferences; membership is checked by the tenant scope.
    app.get(
      '/me/notifications',
      { schema: { params: tenantParams, response: { 200: notificationPrefsResponseSchema } } },
      async (req) => ({ prefs: await service.notificationPrefs(tenantOf(req)) }),
    );

    app.put(
      '/me/notifications',
      {
        schema: {
          params: tenantParams,
          body: notificationPrefsSchema,
          response: { 200: notificationPrefsResponseSchema },
        },
      },
      async (req) => ({
        prefs: await service.updateNotificationPrefs(tenantOf(req), req.body),
      }),
    );
  }
};
