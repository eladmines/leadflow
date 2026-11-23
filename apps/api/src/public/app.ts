import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import type { PrismaClient } from '@prisma/client';
import {
  FORM_TOKEN_PLACEHOLDER,
  HONEYPOT_FIELD,
  LEAD_FORM_PATH,
  leadMessages,
  leadSubmissionSchema,
  renderSiteMessagePage,
  siteError,
  siteText,
  sectionSchema,
  themeSchema,
  type Attribution,
  type BehaviorEvent,
  normalizePagePath,
  type SiteTheme,
} from '@simplecatch/shared';
import { z } from 'zod';
import type { AppConfig } from '../config/env';
import { sha256Hex } from '../lib/crypto';
import { createFormToken, verifyFormToken } from '../lib/form-token';
import { loggerOptions, type LogStream } from '../lib/logger';
import type { EmailSender } from '../integrations/email';
import { LeadService } from '../modules/leads/service';
import { notifyTeamByEmail } from '../modules/leads/notify';
import { AppointmentService } from '../modules/appointments/service';
import { MANAGERS, notifySafe } from '../modules/notifications/service';
import { zonedTimeToUtc } from '../lib/time';
import { PublishedSiteCache, type PublishedPage } from './cache';
import type { StorageProvider } from '../integrations/storage';
import { registerMediaServing } from '../modules/media/serve';
import { readAttributionCookie, rememberVisit } from './attribution';
import { deviceOf, recordEvents } from '../modules/reports/events';
import { SITE_SCRIPT } from '../modules/embed/site-script';
import { isBotAgent, localDay, recordVisit } from '../modules/reports/visits';

/**
 * Public-site server (F06): serves each business's *published* version by Host header,
 * e.g. http://shiran.lvh.me:4100 — or, with PUBLIC_SITE_MODE=path, under APP_URL/s/<subdomain>
 * on the app's own port (hosting without a domain, D-119). Read-only, no auth, no scripts; one
 * cookie, `lf_src`, remembers which ad or site brought the visitor (F26, D-162).
 * Production will move this to a Cloudflare Worker reading snapshots from R2 (D-036).
 */

const SUBDOMAIN = /^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$/;

/**
 * Static sites: the only script is our own first-party one (D-192: counts, no cookies), reporting back
 * to the site's own address; styles inline + Google Fonts; nothing may frame the page.
 */
const SECURITY_HEADERS = {
  'content-security-policy':
    "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
};

const notFoundPage = (title: string, text: string) => `<!doctype html>
<html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${title}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,Arial,sans-serif;background:#f8f5f0;color:#1f2933;text-align:center;padding:24px}h1{font-size:1.6rem;margin:0 0 .4em}p{color:#5f6b74;margin:0}</style>
</head><body><main><h1>${title}</h1><p>${text}</p></main></body></html>`;

interface PublicAppDeps {
  config: AppConfig;
  prisma: PrismaClient;
  /** Shared with the API so publishing invalidates it immediately. */
  cache?: PublishedSiteCache;
  /** New-lead notifications (F07). */
  email: EmailSender;
  /** Uploaded images, served at /media on every site host (same origin → CSP 'self'). */
  storage?: StorageProvider;
  logStream?: LogStream;
}

/** What the site script reports: a few kinds of events and the sections it saw (their element ids). */
const siteEventSchema = z.object({
  ev: z
    .array(z.object({ k: z.enum(['click', 'scroll', 'form']), l: z.string().max(20).optional() }))
    .max(12),
  sec: z.array(z.string().max(60)).max(30).optional(),
});

const publishedContent = z.object({
  theme: themeSchema,
  sections: z.array(sectionSchema),
  pages: z.array(z.object({ slug: z.string(), sections: z.array(sectionSchema) })).catch([]),
  business: z.object({ name: z.string() }),
});

export async function buildPublicApp({
  config,
  prisma,
  cache = new PublishedSiteCache(),
  email,
  storage,
  logStream,
}: PublicAppDeps) {
  const leads = new LeadService(prisma);
  const appointments = new AppointmentService(prisma);
  const app = Fastify({
    logger: loggerOptions(config, logStream),
    genReqId: () => randomUUID(),
    trustProxy: true,
  });
  const suffix = `.${config.PUBLIC_SITE_HOST.toLowerCase()}`;
  const byPath = config.PUBLIC_SITE_MODE === 'path';
  /** The site's address: its own host, or its path on the app's address. */
  const siteOrigin = (subdomain: string) =>
    byPath
      ? `${config.APP_URL}/s/${subdomain}`
      : `${config.PUBLIC_SITE_PROTOCOL}://${subdomain}${suffix}`;
  /** Pages link with root paths (`/`, `/about`, the form's action); under a path they get it. */
  const withBase = (html: string, subdomain: string) =>
    byPath ? html.replace(/(\s(?:href|action)=")\/(?!\/)/g, `$1/s/${subdomain}/`) : html;
  const validSubdomain = (sub: string | undefined) => {
    const s = (sub ?? '').toLowerCase();
    return SUBDOMAIN.test(s) ? s : null;
  };

  // Plain HTML forms post urlencoded bodies; keep them small.
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string', bodyLimit: 16 * 1024 },
    (_req, body, done) => done(null, Object.fromEntries(new URLSearchParams(body as string))),
  );
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: () => Object.assign(new Error('rate limited'), { statusCode: 429 }),
  });

  /** `shiran.lvh.me:4100` → `shiran`; anything else → null. */
  const subdomainOf = (host: string | undefined) => {
    const h = (host ?? '').toLowerCase().replace(/\.$/, '');
    if (!h.endsWith(suffix)) return null;
    const sub = h.slice(0, -suffix.length);
    return SUBDOMAIN.test(sub) ? sub : null;
  };

  /** The business behind a site name, with where its sections are (a few minutes' cache). */
  interface SiteTarget {
    businessId: string;
    timezone: string;
    /** `<section id>` → its page path and name (`services`, `services-2`…). */
    sections: Map<string, { path: string; name: string }>;
    expires: number;
  }
  const siteTargets = new Map<string, SiteTarget>();
  const siteTarget = async (subdomain: string): Promise<SiteTarget | null> => {
    const hit = siteTargets.get(subdomain);
    if (hit && hit.expires > Date.now()) return hit;
    const site = await prisma.site.findUnique({
      where: { subdomain },
      select: {
        businessId: true,
        business: { select: { timezone: true } },
        publishedVersion: { select: { content: true } },
      },
    });
    if (!site) return null;
    const sections = new Map<string, { path: string; name: string }>();
    const content = publishedContent.safeParse(site.publishedVersion?.content);
    if (content.success) {
      const pages = [
        { path: '/', list: content.data.sections },
        ...content.data.pages.map((p) => ({ path: `/${p.slug}`, list: p.sections })),
      ];
      for (const page of pages) {
        const seen = new Map<string, number>();
        for (const sec of page.list) {
          const n = (seen.get(sec.type) ?? 0) + 1;
          seen.set(sec.type, n);
          sections.set(sec.id, { path: page.path, name: n > 1 ? `${sec.type}-${n}` : sec.type });
        }
      }
    }
    const target = {
      businessId: site.businessId,
      timezone: site.business.timezone,
      sections,
      expires: Date.now() + 300_000,
    };
    siteTargets.set(subdomain, target);
    return target;
  };
  const countView = async (
    subdomain: string,
    visit: { attribution: Attribution; entry: boolean },
    pagePath: string,
    ua: string | undefined,
  ) => {
    const target = await siteTarget(subdomain);
    if (!target) return;
    const events: { k: BehaviorEvent; l: string }[] = [{ k: 'page', l: pagePath }];
    if (visit.entry) {
      events.push({ k: 'landing', l: pagePath }, { k: 'device', l: deviceOf(ua) });
      await recordVisit(prisma, target.businessId, target.timezone, visit.attribution);
    }
    await recordEvents(prisma, target.businessId, localDay(target.timezone, new Date()), events);
  };

  const lookup = async (subdomain: string): Promise<PublishedPage> => {
    const hit = cache.get(subdomain);
    if (hit) return hit;
    const site = await prisma.site.findUnique({
      where: { subdomain },
      select: {
        publishedVersion: { select: { id: true, html: true, pageHtml: true, createdAt: true } },
      },
    });
    const pageHtml = site?.publishedVersion?.pageHtml;
    const page: PublishedPage = {
      html: site?.publishedVersion?.html ?? null,
      pages:
        pageHtml && typeof pageHtml === 'object' && !Array.isArray(pageHtml)
          ? (pageHtml as Record<string, string>)
          : {},
      versionId: site?.publishedVersion?.id ?? null,
      updatedAt: site?.publishedVersion?.createdAt ?? null,
    };
    cache.set(subdomain, page);
    return page;
  };

  const send = (
    reply: FastifyReply,
    status: number,
    type: string,
    body: string,
    cacheControl = 'no-store',
  ) =>
    reply
      .status(status)
      .headers(SECURITY_HEADERS)
      .header('content-type', `${type}; charset=utf-8`)
      .header('cache-control', cacheControl)
      .send(body);

  const siteNotFound = (reply: FastifyReply) =>
    send(
      reply,
      404,
      'text/html',
      notFoundPage('האתר לא נמצא', 'ייתכן שהכתובת שגויה, או שהאתר עדיין לא פורסם.'),
    );

  app.get('/health', async () => ({ status: 'ok' }));
  if (storage) registerMediaServing(app, storage);

  /** One site's page, robots.txt or sitemap; `path` is inside the site (`/`, `/about`). */
  const serveSite = async (
    req: FastifyRequest,
    reply: FastifyReply,
    subdomain: string | null,
    path: string,
  ) => {
    if (!subdomain) return siteNotFound(reply);
    const site = await lookup(subdomain);
    if (!site.html) return siteNotFound(reply);

    const origin = siteOrigin(subdomain);
    // `/about` and `/about/` → an extra page (D-081).
    const slug = path.replace(/^\/|\/$/g, '').toLowerCase();
    const pageHtml = path === '/' || path === '/index.html' ? site.html : site.pages[slug];
    if (pageHtml && !slug.includes('/')) {
      // Never cached by browsers: every view gets a fresh form token (its nonce is the lead's
      // idempotency key), and a new publish shows immediately. The server-side cache stays.
      const html = withBase(
        pageHtml
          .replaceAll(FORM_TOKEN_PLACEHOLDER, createFormToken(config.FORM_TOKEN_SECRET, subdomain))
          // F32 (D-192): our own counting script, from the site's own address.
          .replace(
            '</body>',
            `<script defer src="${byPath ? `/s/${subdomain}` : ''}${SITE_SCRIPT_PATH}"></script></body>`,
          ),
        subdomain,
      );
      const visit = rememberVisit(req, reply, {
        landingPath: path,
        cookiePath: byPath ? `/s/${subdomain}` : '/',
        secure: (byPath ? config.APP_URL : origin).startsWith('https:'),
      });
      // F31/F32: counted in the background; a failure is logged, never shown to the visitor. The
      // server sees every page view, so pages, entry pages and devices need no script on the site.
      const ua = req.headers['user-agent'];
      if (!isBotAgent(ua) && !req.headers['purpose']) {
        countView(subdomain, visit, normalizePagePath(path), ua).catch((err) =>
          req.log.error({ errName: (err as Error)?.name }, 'visit count failed'),
        );
      }
      return send(reply, 200, 'text/html', html, 'no-store');
    }
    if (path === '/robots.txt') {
      return send(
        reply,
        200,
        'text/plain',
        `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`,
        'public, max-age=3600',
      );
    }
    if (path === '/sitemap.xml') {
      const lastmod = site.updatedAt ? `<lastmod>${site.updatedAt.toISOString()}</lastmod>` : '';
      return send(
        reply,
        200,
        'application/xml',
        `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${[
          '',
          ...Object.keys(site.pages),
        ]
          .map((p) => `<url><loc>${origin}/${p}</loc>${lastmod}</url>`)
          .join('')}</urlset>\n`,
        'public, max-age=3600',
      );
    }
    return send(
      reply,
      404,
      'text/html',
      notFoundPage('העמוד לא נמצא', 'העמוד שחיפשתם לא קיים באתר הזה.'),
    );
  };

  /** F32 (D-192): the counting script, and where it reports (the site's own address). */
  const SITE_SCRIPT_PATH = '/__sc.js';
  const SITE_EVENTS_PATH = '/__sc';
  const siteScript = async (_req: FastifyRequest, reply: FastifyReply) =>
    send(reply, 200, 'application/javascript', SITE_SCRIPT, 'public, max-age=3600');
  const siteEvents = async (req: FastifyRequest, reply: FastifyReply, sub: string | null) => {
    const done = () => reply.code(204).send();
    if (!sub || isBotAgent(req.headers['user-agent'])) return done();
    let raw: unknown = req.body;
    try {
      if (typeof raw === 'string') raw = JSON.parse(raw);
    } catch {
      return done();
    }
    const body = siteEventSchema.safeParse(raw);
    if (!body.success) return done();
    const target = await siteTarget(sub);
    if (!target) return done();
    const events: { k: BehaviorEvent; l?: string }[] = body.data.ev;
    for (const id of new Set(body.data.sec ?? [])) {
      const sec = target.sections.get(id.replace(/^s-/, ''));
      if (sec) events.push({ k: 'section', l: `${sec.path}#${sec.name}` });
    }
    try {
      await recordEvents(prisma, target.businessId, localDay(target.timezone, new Date()), events);
    } catch (err) {
      req.log.error({ errName: (err as Error)?.name }, 'site event count failed');
    }
    return done();
  };
  const eventsLimit = {
    rateLimit: {
      max: config.EMBED_EVENT_RATE_LIMIT_MAX,
      timeWindow: config.LEAD_FORM_RATE_LIMIT_WINDOW,
      keyGenerator: (req: FastifyRequest) =>
        `${req.ip}|${req.host}|${(req.params as { sub?: string }).sub ?? ''}`,
    },
  };

  if (byPath) {
    app.get(`/s/:sub${SITE_SCRIPT_PATH}`, siteScript);
    app.post<{ Params: { sub: string } }>(
      `/s/:sub${SITE_EVENTS_PATH}`,
      { bodyLimit: 16 * 1024, config: eventsLimit },
      (req, reply) => siteEvents(req, reply, validSubdomain(req.params.sub)),
    );
    app.get<{ Params: { sub: string } }>('/s/:sub', (req, reply) =>
      serveSite(req, reply, validSubdomain(req.params.sub), '/'),
    );
    app.get<{ Params: { sub: string; '*': string } }>('/s/:sub/*', (req, reply) =>
      serveSite(req, reply, validSubdomain(req.params.sub), `/${req.params['*'].split('?')[0]}`),
    );
  } else {
    app.get(SITE_SCRIPT_PATH, siteScript);
    app.post(SITE_EVENTS_PATH, { bodyLimit: 16 * 1024, config: eventsLimit }, (req, reply) =>
      siteEvents(req, reply, subdomainOf(req.host)),
    );
    app.get('/*', (req, reply) =>
      serveSite(req, reply, subdomainOf(req.host), req.url.split('?')[0]!),
    );
  }

  /** A result page in the site's own look. */
  const message = (
    reply: FastifyReply,
    subdomain: string,
    status: number,
    theme: SiteTheme,
    businessName: string,
    page: { title: string; text: string; items?: string[] },
  ) =>
    send(
      reply,
      status,
      'text/html',
      withBase(
        renderSiteMessagePage(
          theme,
          { name: businessName },
          { ...page, backLabel: siteText(theme.language).result.back },
        ),
        subdomain,
      ),
    );

  app.post<{ Params: { sub?: string } }>(
    byPath ? `/s/:sub${LEAD_FORM_PATH}` : LEAD_FORM_PATH,
    {
      config: {
        rateLimit: {
          max: config.LEAD_FORM_RATE_LIMIT_MAX,
          timeWindow: config.LEAD_FORM_RATE_LIMIT_WINDOW,
          keyGenerator: (req) =>
            `${req.ip}|${req.host}|${(req.params as { sub?: string }).sub ?? ''}`,
        },
      },
    },
    async (req, reply) => {
      const subdomain = byPath ? validSubdomain(req.params.sub) : subdomainOf(req.host);
      if (!subdomain) return siteNotFound(reply);
      const site = await prisma.site.findUnique({
        where: { subdomain },
        select: { id: true, businessId: true, publishedVersion: { select: { content: true } } },
      });
      const parsed = publishedContent.safeParse(site?.publishedVersion?.content);
      if (!site || !parsed.success) return siteNotFound(reply);
      const { theme, sections, pages, business } = parsed.data;

      const body = (req.body ?? {}) as Record<string, string>;
      // The form can be on any page; section ids are unique across the site (D-081).
      const pageSlug = pages.some((p) => p.slug === body._p) ? body._p! : '';
      const section = [...sections, ...pages.flatMap((p) => p.sections)].find(
        (s) => s.type === 'contact' && s.visible && s.form.enabled && s.id === body._s,
      );
      if (!section || section.type !== 'contact') return siteNotFound(reply);
      // Result pages in the site's language (D-142).
      const L = siteText(theme.language);
      const thanks = { title: L.result.thanks, text: section.form.successMessage };

      // Bots: pretend success, store nothing (they learn nothing from the response).
      if (body[HONEYPOT_FIELD]) {
        req.log.info({ subdomain, reason: 'honeypot' }, 'lead form spam dropped');
        return message(reply, subdomain, 200, theme, business.name, thanks);
      }
      const token = verifyFormToken(config.FORM_TOKEN_SECRET, subdomain, body._t);
      if (!token.ok) {
        return message(reply, subdomain, 400, theme, business.name, {
          title: L.result.notSent,
          text: siteError(theme.language, leadMessages.formExpired),
        });
      }
      if (token.tooFast) {
        req.log.info({ subdomain, reason: 'too_fast' }, 'lead form spam dropped');
        return message(reply, subdomain, 200, theme, business.name, thanks);
      }

      const data = leadSubmissionSchema.safeParse(body);
      if (!data.success) {
        return message(reply, subdomain, 400, theme, business.name, {
          title: L.result.almost,
          text: L.result.fix,
          items: [...new Set(data.error.issues.map((i) => siteError(theme.language, i.message)))],
        });
      }

      // F17: a requested appointment slot, read in the business's time zone.
      let slot: Date | null = null;
      if (data.data.date && data.data.time) {
        const { timezone } = await prisma.business.findUniqueOrThrow({
          where: { id: site.businessId },
          select: { timezone: true },
        });
        slot = zonedTimeToUtc(data.data.date, data.data.time, timezone);
        const ahead = slot.getTime() - Date.now();
        if (Number.isNaN(ahead) || ahead <= 0 || ahead > 120 * 86_400_000) {
          return message(reply, subdomain, 400, theme, business.name, {
            title: L.result.almost,
            text: L.result.fix,
            items: [siteError(theme.language, leadMessages.slotPast)],
          });
        }
      }

      const { lead, created } = await leads.createFromWebsite({
        businessId: site.businessId,
        siteId: site.id,
        idempotencyKey: token.nonce,
        ipHash: sha256Hex(`${req.ip}|${config.FORM_TOKEN_SECRET}`),
        sourceUrl: `${siteOrigin(subdomain)}/${pageSlug}`,
        attribution: readAttributionCookie(req),
        data: data.data,
      });
      if (created) {
        req.log.info({ businessId: site.businessId, leadId: lead.id }, 'lead created from website');
        let requested: string | null = null;
        if (slot) {
          try {
            await appointments.requestFromWebsite({
              businessId: site.businessId,
              leadId: lead.id,
              contactId: lead.contact.id,
              serviceId: data.data.serviceId,
              startsAt: slot,
            });
            requested = `${data.data.date!.split('-').reverse().join('/')} ${data.data.time}`;
          } catch (err) {
            // The lead is saved either way; the request can be booked by hand from it.
            req.log.error({ errName: (err as Error)?.name }, 'appointment request failed');
          }
        }
        // In the background; a failure is logged, never left unhandled (it could stop the server).
        notifyTeamByEmail(
          { prisma, email, config },
          site.businessId,
          business.name,
          data.data,
          req.log,
          requested,
        ).catch((err) =>
          req.log.error({ errName: (err as Error)?.name }, 'lead notification failed'),
        );
        // In-app: the bell and a pop-up for everyone who sees all leads (D-097).
        await notifySafe(prisma, req.log, {
          businessId: site.businessId,
          type: 'lead.new',
          data: {
            leadId: lead.id,
            name: lead.contact.name,
            source: 'website_form',
            ...(requested ? { appointment: requested } : {}),
          },
          to: { roles: MANAGERS },
        });
      }
      return message(reply, subdomain, 200, theme, business.name, thanks);
    },
  );

  app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
    if (err.statusCode === 429) {
      return send(
        reply,
        429,
        'text/html',
        notFoundPage('יותר מדי ניסיונות', 'שלחתם כמה פניות ברצף. נסו שוב בעוד כמה דקות.'),
      );
    }
    if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
      return send(reply, 400, 'text/html', notFoundPage('הבקשה אינה תקינה', 'חזרו לאתר ונסו שוב.'));
    }
    req.log.error({ err }, 'public site error');
    return send(reply, 500, 'text/html', notFoundPage('אירעה תקלה', 'נסו לרענן את הדף בעוד רגע.'));
  });

  return app;
}
