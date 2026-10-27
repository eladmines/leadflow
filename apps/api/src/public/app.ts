import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyReply } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import type { PrismaClient } from '@prisma/client';
import {
  formatIsraeliPhone,
  FORM_TOKEN_PLACEHOLDER,
  HONEYPOT_FIELD,
  LEAD_FORM_PATH,
  leadMessages,
  leadSubmissionSchema,
  renderSiteMessagePage,
  sectionSchema,
  themeSchema,
  type SiteTheme,
} from '@leadflow/shared';
import { z } from 'zod';
import type { AppConfig } from '../config/env';
import { sha256Hex } from '../lib/crypto';
import { createFormToken, verifyFormToken } from '../lib/form-token';
import { loggerOptions, type LogStream } from '../lib/logger';
import { newLeadTemplate, type EmailSender } from '../integrations/email';
import { LeadService } from '../modules/leads/service';
import { PublishedSiteCache, type PublishedPage } from './cache';

/**
 * Public-site server (F06): serves each business's *published* version by Host header,
 * e.g. http://shiran.lvh.me:4100. Read-only, no cookies, no auth, no scripts.
 * Production will move this to a Cloudflare Worker reading snapshots from R2 (D-036).
 */

const SUBDOMAIN = /^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$/;

/** Static sites only: no scripts, styles inline + Google Fonts, nothing may frame the page. */
const SECURITY_HEADERS = {
  'content-security-policy':
    "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
};

const notFoundPage = (title: string, text: string) => `<!doctype html>
<html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${title}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,Arial,sans-serif;background:#f8f5f0;color:#1f2933;text-align:center;padding:24px}h1{font-size:1.6rem;margin:0 0 .4em}p{color:#5f6b74;margin:0}</style>
</head><body><main><h1>${title}</h1><p>${text}</p></main></body></html>`;

export interface PublicAppDeps {
  config: AppConfig;
  prisma: PrismaClient;
  /** Shared with the API so publishing invalidates it immediately. */
  cache?: PublishedSiteCache;
  /** New-lead notifications (F07). */
  email: EmailSender;
  logStream?: LogStream;
}

const publishedContent = z.object({
  theme: themeSchema,
  sections: z.array(sectionSchema),
  business: z.object({ name: z.string() }),
});

export async function buildPublicApp({
  config,
  prisma,
  cache = new PublishedSiteCache(),
  email,
  logStream,
}: PublicAppDeps) {
  const leads = new LeadService(prisma);
  const app = Fastify({
    logger: loggerOptions(config, logStream),
    genReqId: () => randomUUID(),
    trustProxy: true,
  });
  const suffix = `.${config.PUBLIC_SITE_HOST.toLowerCase()}`;

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

  const lookup = async (subdomain: string): Promise<PublishedPage> => {
    const hit = cache.get(subdomain);
    if (hit) return hit;
    const site = await prisma.site.findUnique({
      where: { subdomain },
      select: { publishedVersion: { select: { id: true, html: true, createdAt: true } } },
    });
    const page: PublishedPage = {
      html: site?.publishedVersion?.html ?? null,
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

  app.get('/*', async (req, reply) => {
    const subdomain = subdomainOf(req.host);
    if (!subdomain) return siteNotFound(reply);
    const site = await lookup(subdomain);
    if (!site.html) return siteNotFound(reply);

    const path = req.url.split('?')[0];
    const origin = `${config.PUBLIC_SITE_PROTOCOL}://${subdomain}${suffix}`;
    if (path === '/' || path === '/index.html') {
      // Never cached by browsers: every view gets a fresh form token (its nonce is the lead's
      // idempotency key), and a new publish shows immediately. The server-side cache stays.
      const html = site.html.replaceAll(
        FORM_TOKEN_PLACEHOLDER,
        createFormToken(config.FORM_TOKEN_SECRET, subdomain),
      );
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
        `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${origin}/</loc>${lastmod}</url></urlset>\n`,
        'public, max-age=3600',
      );
    }
    return send(
      reply,
      404,
      'text/html',
      notFoundPage('העמוד לא נמצא', 'העמוד שחיפשתם לא קיים באתר הזה.'),
    );
  });

  /** A result page in the site's own look. */
  const message = (
    reply: FastifyReply,
    status: number,
    theme: SiteTheme,
    businessName: string,
    page: { title: string; text: string; items?: string[] },
  ) =>
    send(
      reply,
      status,
      'text/html',
      renderSiteMessagePage(theme, { name: businessName }, { ...page, backLabel: 'חזרה לאתר' }),
    );

  app.post(
    LEAD_FORM_PATH,
    {
      config: {
        rateLimit: {
          max: config.LEAD_FORM_RATE_LIMIT_MAX,
          timeWindow: config.LEAD_FORM_RATE_LIMIT_WINDOW,
          keyGenerator: (req) => `${req.ip}|${req.host}`,
        },
      },
    },
    async (req, reply) => {
      const subdomain = subdomainOf(req.host);
      if (!subdomain) return siteNotFound(reply);
      const site = await prisma.site.findUnique({
        where: { subdomain },
        select: { id: true, businessId: true, publishedVersion: { select: { content: true } } },
      });
      const parsed = publishedContent.safeParse(site?.publishedVersion?.content);
      if (!site || !parsed.success) return siteNotFound(reply);
      const { theme, sections, business } = parsed.data;

      const body = (req.body ?? {}) as Record<string, string>;
      const section = sections.find(
        (s) => s.type === 'contact' && s.visible && s.form.enabled && s.id === body._s,
      );
      if (!section || section.type !== 'contact') return siteNotFound(reply);
      const thanks = { title: 'תודה!', text: section.form.successMessage };

      // Bots: pretend success, store nothing (they learn nothing from the response).
      if (body[HONEYPOT_FIELD]) {
        req.log.info({ subdomain, reason: 'honeypot' }, 'lead form spam dropped');
        return message(reply, 200, theme, business.name, thanks);
      }
      const token = verifyFormToken(config.FORM_TOKEN_SECRET, subdomain, body._t);
      if (!token.ok) {
        return message(reply, 400, theme, business.name, {
          title: 'לא הצלחנו לשלוח',
          text: leadMessages.formExpired,
        });
      }
      if (token.tooFast) {
        req.log.info({ subdomain, reason: 'too_fast' }, 'lead form spam dropped');
        return message(reply, 200, theme, business.name, thanks);
      }

      const data = leadSubmissionSchema.safeParse(body);
      if (!data.success) {
        return message(reply, 400, theme, business.name, {
          title: 'כמעט — חסרים כמה פרטים',
          text: 'יש לתקן את הפרטים הבאים ולשלוח שוב:',
          items: [...new Set(data.error.issues.map((i) => i.message))],
        });
      }

      const { lead, created } = await leads.createFromWebsite({
        businessId: site.businessId,
        siteId: site.id,
        idempotencyKey: token.nonce,
        ipHash: sha256Hex(`${req.ip}|${config.FORM_TOKEN_SECRET}`),
        sourceUrl: `${config.PUBLIC_SITE_PROTOCOL}://${subdomain}${suffix}/`,
        data: data.data,
      });
      if (created) {
        req.log.info({ businessId: site.businessId, leadId: lead.id }, 'lead created from website');
        void notifyTeam(site.businessId, business.name, data.data, req.log);
      }
      return message(reply, 200, theme, business.name, thanks);
    },
  );

  /** Emails owners and managers (best effort: a failed email never loses the lead). */
  async function notifyTeam(
    businessId: string,
    businessName: string,
    d: z.output<typeof leadSubmissionSchema>,
    log: { error: (obj: object, msg: string) => void },
  ) {
    const team = await prisma.membership.findMany({
      where: { businessId, status: 'ACTIVE', role: { in: ['OWNER', 'MANAGER'] } },
      select: { user: { select: { email: true, status: true } } },
    });
    const mail = newLeadTemplate({
      businessName,
      name: d.name,
      phone: formatIsraeliPhone(d.phone),
      email: d.email,
      message: d.message,
      link: `${config.APP_URL}/b/${businessId}/leads`,
    });
    for (const { user } of team) {
      if (user.status !== 'ACTIVE') continue;
      try {
        await email.send({ to: user.email, ...mail });
      } catch (err) {
        log.error({ errName: (err as Error)?.name, template: 'newLead' }, 'lead email failed');
      }
    }
  }

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
