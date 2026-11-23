import type { FastifyPluginAsync } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  apiPaths,
  classifyAttribution,
  embedInfoSchema,
  embedLeadRequestSchema,
  embedVisitRequestSchema,
  embedEventRequestSchema,
  leadSubmissionSchema,
  pickTrackedParams,
  siteError,
  type EmbedLeadResponse,
  type SiteLanguage,
} from '@simplecatch/shared';
import { sha256Hex } from '../../lib/crypto';
import { requirePermission, tenantOf } from '../../plugins/tenant';
import { LeadService } from '../leads/service';
import { notifyTeamByEmail } from '../leads/notify';
import { MANAGERS, notifySafe } from '../notifications/service';
import { recordEvents } from '../reports/events';
import { isBotAgent, localDay, recordVisit } from '../reports/visits';
import { createEmbedKey, readEmbedKey } from './key';
import { EMBED_SCRIPT } from './script';

/** What the script needs to put on a site: owner only (it names the business's key). */
export const embedTenantRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/embed',
    {
      preValidation: requirePermission('business.update'),
      schema: { response: { 200: embedInfoSchema } },
    },
    async (req) => {
      const key = createEmbedKey(app.config.FORM_TOKEN_SECRET, tenantOf(req).businessId);
      const scriptUrl = `${app.config.APP_URL}${apiPaths.embed.script}`;
      return {
        scriptUrl,
        key,
        snippet: `<script async src="${scriptUrl}" data-key="${key}"></script>`,
      };
    },
  );
};

const CORS = { 'access-control-allow-origin': '*', vary: 'Origin' } as const;

/**
 * F30 — public, no cookies. The script is cacheable; the lead endpoint takes a text/plain JSON body
 * (a "simple" cross-origin request, so no preflight) and always answers with CORS headers.
 */
export const embedPublicRoutes: FastifyPluginAsync = async (app) => {
  const leads = new LeadService(app.prisma);

  app.get(apiPaths.embed.script, async (_req, reply) =>
    reply
      .header('content-type', 'application/javascript; charset=utf-8')
      .header('cache-control', 'public, max-age=3600')
      .header('access-control-allow-origin', '*')
      .send(EMBED_SCRIPT),
  );

  // Own parser for this scope: a JSON string sent as text/plain, small.
  app.addContentTypeParser(
    'text/plain',
    { parseAs: 'string', bodyLimit: 16 * 1024 },
    (_req, body, done) => {
      try {
        done(null, JSON.parse(body as string));
      } catch {
        done(null, null);
      }
    },
  );

  app.post(
    apiPaths.embed.lead,
    {
      bodyLimit: 16 * 1024,
      config: {
        rateLimit: {
          max: app.config.LEAD_FORM_RATE_LIMIT_MAX,
          timeWindow: app.config.LEAD_FORM_RATE_LIMIT_WINDOW,
          keyGenerator: (req) => req.ip,
        },
      },
    },
    async (req, reply) => {
      const answer = (status: number, body: EmbedLeadResponse) =>
        reply.code(status).headers(CORS).send(body);

      const parsed = embedLeadRequestSchema.safeParse(req.body);
      if (!parsed.success) return answer(400, { ok: false });
      const body = parsed.data;
      const businessId = readEmbedKey(app.config.FORM_TOKEN_SECRET, body.key);
      const business = businessId
        ? await app.prisma.business.findUnique({
            where: { id: businessId },
            select: { id: true, name: true, language: true },
          })
        : null;
      // A wrong key looks like any other bad request.
      if (!business) return answer(400, { ok: false });

      // Bots: pretend success, store nothing.
      if (body.website) {
        req.log.info({ businessId: business.id, reason: 'honeypot' }, 'embed lead dropped');
        return answer(200, { ok: true });
      }

      const lang = (business.language === 'en' ? 'en' : 'he') as SiteLanguage;
      const data = leadSubmissionSchema.safeParse({
        name: body.name,
        phone: body.phone,
        email: body.email,
        message: body.message,
        // A form on the owner's own website: sending it is asking to be contacted (D-197).
        consent: 'on',
      });
      if (!data.success) {
        return answer(400, {
          ok: false,
          errors: [...new Set(data.error.issues.map((i) => siteError(lang, i.message)))],
        });
      }

      let host: string | undefined;
      try {
        host = body.page ? new URL(body.page).host : undefined;
      } catch {
        host = undefined;
      }
      const attribution = classifyAttribution({
        params: pickTrackedParams(body.params),
        referrer: body.referrer ?? null,
        selfHost: host,
        landingPath: pathOf(body.landing),
      });

      const { lead, created } = await leads.createFromWebsite({
        businessId: business.id,
        siteId: null,
        idempotencyKey: body.id,
        ipHash: sha256Hex(`${req.ip}|${app.config.FORM_TOKEN_SECRET}`),
        sourceUrl: (body.page ?? '').split(/[?#]/)[0]!.slice(0, 300) || 'embed',
        // A direct visit keeps its landing page (F32 shows inquiries per landing page); Reports
        // and the leads filter read source "direct" as unknown.
        attribution,
        data: data.data,
      });
      if (created) {
        req.log.info({ businessId: business.id, leadId: lead.id }, 'lead created from embed');
        notifyTeamByEmail(
          { prisma: app.prisma, email: app.email, config: app.config },
          business.id,
          business.name,
          data.data,
          req.log,
        ).catch((err) =>
          req.log.error({ errName: (err as Error)?.name }, 'lead notification failed'),
        );
        await notifySafe(app.prisma, req.log, {
          businessId: business.id,
          type: 'lead.new',
          data: { leadId: lead.id, name: lead.contact.name, source: 'website_form' },
          to: { roles: MANAGERS },
        });
      }
      return answer(200, { ok: true });
    },
  );

  // F31: a page view, once per browser session (the script keeps the flag). Counted, not stored.
  app.post(
    apiPaths.embed.visit,
    {
      bodyLimit: 16 * 1024,
      config: {
        rateLimit: {
          max: app.config.EMBED_VISIT_RATE_LIMIT_MAX,
          timeWindow: app.config.LEAD_FORM_RATE_LIMIT_WINDOW,
          keyGenerator: (req) => req.ip,
        },
      },
    },
    async (req, reply) => {
      const answer = (status: number) =>
        reply
          .code(status)
          .headers(CORS)
          .send({ ok: status === 200 });
      const parsed = embedVisitRequestSchema.safeParse(req.body);
      if (!parsed.success) return answer(400);
      const body = parsed.data;
      const businessId = readEmbedKey(app.config.FORM_TOKEN_SECRET, body.key);
      const business = businessId
        ? await app.prisma.business.findUnique({
            where: { id: businessId },
            select: { id: true, timezone: true },
          })
        : null;
      if (!business) return answer(400);
      if (isBotAgent(req.headers['user-agent'])) return answer(200);
      let host: string | undefined;
      try {
        host = body.page ? new URL(body.page).host : undefined;
      } catch {
        host = undefined;
      }
      const attribution = classifyAttribution({
        params: pickTrackedParams(body.params),
        referrer: body.referrer ?? null,
        selfHost: host,
        landingPath: pathOf(body.landing),
      });
      try {
        await recordVisit(app.prisma, business.id, business.timezone, attribution);
      } catch (err) {
        req.log.error({ errName: (err as Error)?.name }, 'visit count failed');
      }
      return answer(200);
    },
  );

  // F32: what happened on a page. Counted per kind and label; the script batches a few per view.
  app.post(
    apiPaths.embed.event,
    {
      bodyLimit: 16 * 1024,
      config: {
        rateLimit: {
          max: app.config.EMBED_EVENT_RATE_LIMIT_MAX,
          timeWindow: app.config.LEAD_FORM_RATE_LIMIT_WINDOW,
          keyGenerator: (req) => req.ip,
        },
      },
    },
    async (req, reply) => {
      const answer = (status: number) =>
        reply
          .code(status)
          .headers(CORS)
          .send({ ok: status === 200 });
      const parsed = embedEventRequestSchema.safeParse(req.body);
      if (!parsed.success) return answer(400);
      const businessId = readEmbedKey(app.config.FORM_TOKEN_SECRET, parsed.data.key);
      const business = businessId
        ? await app.prisma.business.findUnique({
            where: { id: businessId },
            select: { id: true, timezone: true },
          })
        : null;
      if (!business) return answer(400);
      if (isBotAgent(req.headers['user-agent'])) return answer(200);
      try {
        await recordEvents(
          app.prisma,
          business.id,
          localDay(business.timezone, new Date()),
          parsed.data.events,
        );
      } catch (err) {
        req.log.error({ errName: (err as Error)?.name }, 'event count failed');
      }
      return answer(200);
    },
  );
};

function pathOf(url: string | undefined) {
  if (!url) return undefined;
  try {
    return new URL(url).pathname;
  } catch {
    return undefined;
  }
}
