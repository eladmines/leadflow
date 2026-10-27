import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyReply } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { AppConfig } from '../config/env';
import { loggerOptions, type LogStream } from '../lib/logger';
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
  logStream?: LogStream;
}

export async function buildPublicApp({
  config,
  prisma,
  cache = new PublishedSiteCache(),
  logStream,
}: PublicAppDeps) {
  const app = Fastify({
    logger: loggerOptions(config, logStream),
    genReqId: () => randomUUID(),
    trustProxy: true,
  });
  const suffix = `.${config.PUBLIC_SITE_HOST.toLowerCase()}`;

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
      // Browsers revalidate on every visit; the version id as ETag makes that a cheap 304, and a
      // new publish shows immediately.
      const etag = `"${site.versionId}"`;
      reply.header('etag', etag);
      if (req.headers['if-none-match'] === etag) {
        return reply
          .status(304)
          .headers(SECURITY_HEADERS)
          .header('cache-control', 'no-cache')
          .send();
      }
      return send(reply, 200, 'text/html', site.html, 'no-cache');
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

  app.setErrorHandler((err, req, reply) => {
    req.log.error({ err }, 'public site error');
    return send(reply, 500, 'text/html', notFoundPage('אירעה תקלה', 'נסו לרענן את הדף בעוד רגע.'));
  });

  return app;
}
