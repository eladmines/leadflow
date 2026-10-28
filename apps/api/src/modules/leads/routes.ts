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
import { formatIsraeliPhone, leadSourceLabels } from '@leadflow/shared';
import { toCsv } from '../../lib/csv';
import { requirePermission, tenantOf } from '../../plugins/tenant';
import { recordAudit } from '../audit/service';
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

  // Registered before `/leads/:leadId`; Fastify prefers the static segment anyway.
  app.get(
    '/leads/export.csv',
    {
      preValidation: requirePermission('leads.export'),
      schema: { params, querystring: leadListQuerySchema },
    },
    async (req, reply) => {
      const ctx = tenantOf(req);
      const leads = await service.list(ctx, req.query, 10_000);
      const business = await app.prisma.business.findUniqueOrThrow({
        where: { id: ctx.businessId },
        select: { timezone: true },
      });
      const when = new Intl.DateTimeFormat('he-IL', {
        dateStyle: 'short',
        timeStyle: 'short',
        timeZone: business.timezone,
      });
      const csv = toCsv(
        [
          'שם',
          'טלפון',
          'אימייל',
          'שלב',
          'מקור',
          'אחראי',
          'ערך משוער (₪)',
          'טיפול הבא',
          'פרטי הפנייה',
          'נוצר',
        ],
        leads.map((l) => [
          l.contact.name,
          l.contact.phone ? formatIsraeliPhone(l.contact.phone) : '',
          l.contact.email,
          l.stage.name,
          leadSourceLabels[l.source],
          l.owner?.name,
          l.expectedValue,
          l.nextActionAt ? when.format(new Date(l.nextActionAt)) : '',
          l.message,
          when.format(new Date(l.createdAt)),
        ]),
      );
      await recordAudit(app.prisma, {
        action: 'leads.exported',
        businessId: ctx.businessId,
        actorUserId: ctx.userId,
        entityType: 'lead',
        metadata: { count: leads.length },
      });
      const date = new Date().toISOString().slice(0, 10);
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="leadflow-leads-${date}.csv"`)
        .header('cache-control', 'no-store')
        .send(csv);
    },
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

  app.delete(
    '/leads/:leadId',
    {
      preValidation: requirePermission('leads.delete'),
      schema: { params: leadParams },
    },
    async (req, reply) => {
      await service.remove(tenantOf(req), req.params.leadId);
      return reply.status(204).send();
    },
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
