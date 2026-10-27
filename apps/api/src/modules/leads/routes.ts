import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { leadListResponseSchema } from '@leadflow/shared';
import { requirePermission, tenantOf } from '../../plugins/tenant';
import { LeadService } from './service';

/** Leads (F07 list; F08 adds the CRM). Registered inside the tenant scope. */
export const leadTenantRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = new LeadService(app.prisma);

  app.get(
    '/leads',
    {
      preValidation: requirePermission('leads.view'),
      schema: {
        params: z.object({ businessId: z.string() }),
        response: { 200: leadListResponseSchema },
      },
    },
    async (req) => ({ leads: await service.list(tenantOf(req)) }),
  );
};
