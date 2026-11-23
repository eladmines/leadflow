import { z } from 'zod';

/**
 * F30 — Leads and ad tracking for a website built elsewhere (Wix, WordPress…): one script tag.
 * The script reads the ad click (`utm_*`, click ids) and the referrer on the landing page, keeps
 * them in the visitor's browser, and posts the lead form to SimpleCatch with them. The server names
 * the source with the same rules as its own sites (F26); click id values are never stored.
 * The key in the script is public by design (like any form endpoint): it only lets leads in.
 */

/** Query parameters the script passes on (everything else on the URL is dropped). */
export const EMBED_TRACKED_PARAMS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'gclid',
  'gbraid',
  'wbraid',
  'fbclid',
  'ttclid',
  'msclkid',
] as const;

const short = (max: number) => z.string().max(max).optional().catch(undefined);

/** The lead form as the script posts it (JSON in a text/plain body, so no CORS preflight). */
export const embedLeadRequestSchema = z.object({
  key: z.string().min(10).max(120),
  /** One id per page view and form: a double click creates one lead. */
  id: z.string().regex(/^[A-Za-z0-9_-]{16,40}$/),
  name: z.string().max(200).optional(),
  phone: z.string().max(60).optional(),
  email: z.string().max(300).optional(),
  message: z.string().max(3000).optional(),
  consent: z.string().max(10).optional(),
  /** Field people never see; bots tend to fill it. */
  website: z.string().max(200).optional(),
  /** Where the visit came from: the landing URL's tracked parameters and `document.referrer`. */
  params: z.record(z.string().max(300)).optional().catch(undefined),
  referrer: short(500),
  /** Landing page address (query and fragment are dropped by the server). */
  landing: short(500),
  /** The page the form was sent from. */
  page: short(500),
});
export type EmbedLeadRequest = z.infer<typeof embedLeadRequestSchema>;

/** A page view, once per browser session (F31). Counted, never stored per person. */
export const embedVisitRequestSchema = embedLeadRequestSchema.pick({
  key: true,
  params: true,
  referrer: true,
  landing: true,
  page: true,
});
export type EmbedVisitRequest = z.infer<typeof embedVisitRequestSchema>;

/**
 * F32 — what visitors do on the page, as counts only (never a visitor id). The script sends a small
 * batch per page view: the page, and what happened on it. Only these kinds are accepted.
 */
export const BEHAVIOR_EVENTS = [
  /** A page was opened. Label: its path. */
  'page',
  /** The first page of a browser session. Label: its path. */
  'landing',
  /** The visitor's screen: `mobile`, `tablet` or `desktop` (once per session). */
  'device',
  /** A tap on a contact link: `phone`, `whatsapp` or `email`. */
  'click',
  /** The visitor scrolled to `50` or `90` percent of the page. */
  'scroll',
  /** The visitor started filling a form (label `start`). */
  'form',
  /** A click on an element the owner chose to count (`data-sc-click` or `data-track`). Label: its name. */
  'cta',
  /** A section of a page was on screen for a moment. Label: `<page path>#<section name>`. */
  'section',
  /** A tap or click inside a section. Label: `<page path>#<section name>`. */
  'sclick',
] as const;
export type BehaviorEvent = (typeof BEHAVIOR_EVENTS)[number];

export const embedEventRequestSchema = z.object({
  key: z.string().min(10).max(120),
  events: z
    .array(
      z.object({ k: z.enum(BEHAVIOR_EVENTS), l: z.string().max(200).optional().catch(undefined) }),
    )
    .max(12),
});
export type EmbedEventRequest = z.infer<typeof embedEventRequestSchema>;

/** The name of a counted button: plain text, one line, at most 40 characters; empty means not countable. */
export function normalizeCtaName(input: string | undefined | null): string {
  return (
    (input ?? '')
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 40)
      .trim()
  );
}

/** A section as one label: its page path and name, at most 100 characters in all. */
export function sectionLabel(path: string | undefined | null, name: string | undefined | null) {
  const n = normalizeCtaName(name);
  return n ? `${normalizePagePath(path).slice(0, 59)}#${n}` : '';
}

/** A page address as one stable label: path only, no query or trailing slash, at most 100 characters. */
export function normalizePagePath(input: string | undefined | null): string {
  if (!input) return '/';
  let path = input;
  try {
    path = /^https?:\/\//i.test(input) ? new URL(input).pathname : input;
  } catch {
    path = input;
  }
  path = path.split(/[?#]/)[0] ?? '/';
  if (!path.startsWith('/')) path = `/${path}`;
  if (path.length > 1) path = path.replace(/\/+$/, '');
  return (path || '/').slice(0, 100);
}

export const embedLeadResponseSchema = z.object({
  ok: z.boolean(),
  errors: z.array(z.string()).optional(),
});
export type EmbedLeadResponse = z.infer<typeof embedLeadResponseSchema>;

/** For Settings: what to paste on the site. */
export const embedInfoSchema = z.object({
  scriptUrl: z.string(),
  key: z.string(),
  /** The `<script>` tag, ready to paste before `</body>`. */
  snippet: z.string(),
});
export type EmbedInfo = z.infer<typeof embedInfoSchema>;

export const embedApiPaths = {
  /** GET (owner): the business's script tag. */
  info: (businessId: string) => `/api/v1/businesses/${businessId}/embed`,
  /** Public: the script itself (named neutrally: it counts visits, behavior and leads). */
  script: '/api/v1/embed/sc.js',
  /** Public: where the script posts a lead (no cookies, no CSRF header: protected by the key). */
  lead: '/api/v1/embed/lead',
  /** Public: a visit (F31), same rules as `lead`. */
  visit: '/api/v1/embed/visit',
  /** Public: what happened on a page (F32), same rules as `lead`. */
  event: '/api/v1/embed/event',
} as const;

/** Keeps only the tracked parameters, trimmed (what the script and the server both accept). */
export function pickTrackedParams(
  input: Record<string, string | undefined> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of EMBED_TRACKED_PARAMS) {
    const v = input?.[k]?.trim();
    if (v) out[k] = v.slice(0, 200);
  }
  return out;
}
