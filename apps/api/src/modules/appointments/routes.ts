import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  appointmentListQuerySchema,
  appointmentListResponseSchema,
  appointmentResponseSchema,
  createAppointmentRequestSchema,
  serviceListResponseSchema,
  serviceResponseSchema,
  updateAppointmentRequestSchema,
  upsertServiceRequestSchema,
} from '@leadflow/shared';
import { requirePermission, tenantOf } from '../../plugins/tenant';
import { AppointmentService } from './service';

const params = z.object({ businessId: z.string() });
const idParams = z.object({ businessId: z.string(), id: z.string() });

/** Services and appointments (F17); registered inside the tenant scope. */
export const appointmentTenantRoutes: FastifyPluginAsyncZod = async (app) => {
  const svc = new AppointmentService(app.prisma);
  const view = { preValidation: requirePermission('appointments.view') };
  const manage = { preValidation: requirePermission('services.manage') };

  app.get(
    '/services',
    { ...view, schema: { params, response: { 200: serviceListResponseSchema } } },
    async (req) => ({ services: await svc.listServices(tenantOf(req)) }),
  );
  app.post(
    '/services',
    {
      ...manage,
      schema: {
        params,
        body: upsertServiceRequestSchema,
        response: { 201: serviceResponseSchema },
      },
    },
    async (req, reply) =>
      reply.status(201).send({ service: await svc.createService(tenantOf(req), req.body) }),
  );
  app.put(
    '/services/:id',
    {
      ...manage,
      schema: {
        params: idParams,
        body: upsertServiceRequestSchema,
        response: { 200: serviceResponseSchema },
      },
    },
    async (req) => ({ service: await svc.updateService(tenantOf(req), req.params.id, req.body) }),
  );
  app.delete('/services/:id', { ...manage, schema: { params: idParams } }, async (req, reply) => {
    await svc.removeService(tenantOf(req), req.params.id);
    return reply.status(204).send();
  });

  app.get(
    '/appointments',
    {
      ...view,
      schema: {
        params,
        querystring: appointmentListQuerySchema,
        response: { 200: appointmentListResponseSchema },
      },
    },
    async (req) => ({ appointments: await svc.list(tenantOf(req), req.query) }),
  );
  // Static segment before `/appointments/:id`.
  app.get(
    '/appointments/requests',
    { ...view, schema: { params, response: { 200: appointmentListResponseSchema } } },
    async (req) => ({ appointments: await svc.requests(tenantOf(req)) }),
  );
  app.post(
    '/appointments',
    {
      ...view,
      schema: {
        params,
        body: createAppointmentRequestSchema,
        response: { 201: appointmentResponseSchema },
      },
    },
    async (req, reply) =>
      reply.status(201).send({ appointment: await svc.create(tenantOf(req), req.body) }),
  );
  app.patch(
    '/appointments/:id',
    {
      ...view,
      schema: {
        params: idParams,
        body: updateAppointmentRequestSchema,
        response: { 200: appointmentResponseSchema },
      },
    },
    async (req) => ({
      appointment: await svc.update(tenantOf(req), req.params.id, req.body),
    }),
  );
};
