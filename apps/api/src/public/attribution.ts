import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  attributionSchema,
  classifyAttribution,
  isCampaignVisit,
  type Attribution,
} from '@leadflow/shared';

/**
 * F26 — the `lf_src` cookie on a business's site (D-162): where the visit came from, until the form
 * is sent. Values only (source, campaign names, hosts, paths) — no visitor id, no click id value.
 */
export const ATTRIBUTION_COOKIE = 'lf_src';
const MAX_AGE_SECONDS = 30 * 86_400;

const encode = (a: Attribution) => Buffer.from(JSON.stringify(a)).toString('base64url');

/** The visitor can change the cookie: anything that doesn't parse is ignored. */
export function readAttributionCookie(req: FastifyRequest): Attribution | null {
  const raw = (req.headers.cookie ?? '')
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${ATTRIBUTION_COOKIE}=`))
    ?.slice(ATTRIBUTION_COOKIE.length + 1);
  if (!raw || raw.length > 2000) return null;
  try {
    const parsed = attributionSchema.safeParse(
      JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * On a page view: an ad click or tagged link replaces what's stored; otherwise the first visit
 * stays. Direct visits and the site's own pages set nothing (no cookie = direct).
 */
export function rememberVisit(
  req: FastifyRequest,
  reply: FastifyReply,
  opts: { landingPath: string; cookiePath: string; secure: boolean },
) {
  const query = (req.query ?? {}) as Record<string, unknown>;
  const params = Object.fromEntries(
    Object.entries(query).map(([k, v]) => [k, typeof v === 'string' ? v : undefined]),
  );
  const visit = classifyAttribution({
    params,
    referrer: req.headers.referer ?? null,
    selfHost: req.host,
    landingPath: opts.landingPath,
  });
  if (visit.source === 'direct') return;
  if (!isCampaignVisit(visit) && readAttributionCookie(req)) return;
  reply.header(
    'set-cookie',
    `${ATTRIBUTION_COOKIE}=${encode(visit)}; Max-Age=${MAX_AGE_SECONDS}; Path=${opts.cookiePath}; HttpOnly; SameSite=Lax${opts.secure ? '; Secure' : ''}`,
  );
}
