import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  activitySchema,
  addNoteRequestSchema,
  createLeadRequestSchema,
  duplicateQuerySchema,
  duplicatesResponseSchema,
  leadDetailResponseSchema,
  leadListQuerySchema,
  leadListResponseSchema,
  leadResponseSchema,
  pipelineResponseSchema,
  updateLeadRequestSchema,
} from '@leadflow/shared';
import { requirePermission, tenantOf } from '../../plugins/tenant';
import { LeadService } from './service';

const params = z.object({ businessId: z.string() });
const leadParams = z.object({ businessId: z.string(), leadId: z.string() });

/** Leads & CRM (F07 list, F08 CRM). Registered inside the tenant scope. */
export const leadTenantRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = new LeadService(app.prisma);

  app.get(
    '/leads',
    {
      preValidation: requirePermission('leads.view'),
      schema: {
        params,
        querystring: leadListQuerySchema,
        response: { 200: leadListResponseSchema },
      },
    },
    async (req) => ({ leads: await service.list(tenantOf(req), req.query) }),
  );

  app.post(
    '/leads',
    {
      preValidation: requirePermission('leads.create'),
      schema: { params, body: createLeadRequestSchema, response: { 201: leadResponseSchema } },
    },
    async (req, reply) =>
      reply.status(201).send({ lead: await service.create(tenantOf(req), req.body) }),
  );

  app.get(
    '/leads/:leadId',
    {
      preValidation: requirePermission('leads.view'),
      schema: { params: leadParams, response: { 200: leadDetailResponseSchema } },
    },
    async (req) => service.detail(tenantOf(req), req.params.leadId),
  );

  app.patch(
    '/leads/:leadId',
    {
      preValidation: requirePermission('leads.update'),
      schema: {
        params: leadParams,
        body: updateLeadRequestSchema,
        response: { 200: leadResponseSchema },
      },
    },
    async (req) => ({ lead: await service.update(tenantOf(req), req.params.leadId, req.body) }),
  );

  app.post(
    '/leads/:leadId/notes',
    {
      preValidation: requirePermission('leads.update'),
      schema: {
        params: leadParams,
        body: addNoteRequestSchema,
        response: { 201: z.object({ activity: activitySchema }) },
      },
    },
    async (req, reply) =>
      reply
        .status(201)
        .send({ activity: await service.addNote(tenantOf(req), req.params.leadId, req.body.text) }),
  );

  app.get(
    '/pipeline',
    {
      preValidation: requirePermission('leads.view'),
      schema: { params, response: { 200: pipelineResponseSchema } },
    },
    async (req) => ({ stages: await service.pipeline(tenantOf(req)) }),
  );

  app.get(
    '/contacts/duplicates',
    {
      preValidation: requirePermission('leads.create'),
      schema: {
        params,
        querystring: duplicateQuerySchema,
        response: { 200: duplicatesResponseSchema },
      },
    },
    async (req) => ({
      contacts: await service.duplicates(tenantOf(req), req.query.phone, req.query.email),
    }),
  );
};
