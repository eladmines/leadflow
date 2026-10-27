import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  assetListResponseSchema,
  assetResponseSchema,
  MAX_UPLOAD_BYTES,
  mediaMessages,
} from '@leadflow/shared';
import { AppError } from '../../lib/errors';
import { requirePermission, tenantOf } from '../../plugins/tenant';
import { MediaService } from './service';

const params = z.object({ businessId: z.string() });
const assetParams = z.object({ businessId: z.string(), assetId: z.string() });

/** Image library of a business; registered inside the tenant scope. */
export const mediaTenantRoutes: FastifyPluginAsyncZod = async (app) => {
  const media = new MediaService(app.prisma, app.storage, app.config);

  app.get(
    '/assets',
    {
      preValidation: requirePermission('site.view'),
      schema: { params, response: { 200: assetListResponseSchema } },
    },
    async (req) => media.list(tenantOf(req)),
  );

  app.post(
    '/assets',
    {
      preValidation: requirePermission('site.edit'),
      schema: { params, response: { 201: assetResponseSchema } },
    },
    async (req, reply) => {
      if (!req.isMultipart()) throw new AppError('VALIDATION_ERROR', mediaMessages.noFile);
      const file = await req.file({ limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });
      if (!file) throw new AppError('VALIDATION_ERROR', mediaMessages.noFile);
      let buffer: Buffer;
      try {
        buffer = await file.toBuffer();
      } catch {
        throw new AppError('VALIDATION_ERROR', mediaMessages.tooLarge);
      }
      if (file.file.truncated) throw new AppError('VALIDATION_ERROR', mediaMessages.tooLarge);
      const asset = await media.upload(tenantOf(req), buffer, file.filename || null);
      return reply.status(201).send({ asset });
    },
  );

  app.delete(
    '/assets/:assetId',
    { preValidation: requirePermission('site.edit'), schema: { params: assetParams } },
    async (req, reply) => {
      await media.remove(tenantOf(req), req.params.assetId);
      return reply.status(204).send();
    },
  );
};
