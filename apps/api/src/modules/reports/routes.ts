import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { reportQuerySchema, reportSummarySchema } from '@leadflow/shared';
import { requirePermission, tenantOf } from '../../plugins/tenant';
import { ReportService } from './service';

/** Basic reports (F20 lite); registered inside the tenant scope. */
export const reportTenantRoutes: FastifyPluginAsyncZod = async (app) => {
  const reports = new ReportService(app.prisma);
  app.get(
    '/reports/summary',
    {
      preValidation: requirePermission('reports.view'),
      schema: {
        params: z.object({ businessId: z.string() }),
        querystring: reportQuerySchema,
        response: { 200: reportSummarySchema },
      },
    },
    async (req) => reports.summary(tenantOf(req), req.query.days),
  );
};
