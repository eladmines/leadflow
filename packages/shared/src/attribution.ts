import { z } from 'zod';

/**
 * F26 — Where a lead came from: the source, ad and campaign behind it (D-162).
 * Website leads: read from the landing URL (click ids, `utm_*`) and the referrer by the public site
 * server, kept in a first-party cookie until the form is sent. WhatsApp/Messenger leads: Meta's ad
 * `referral`. Only names are kept — never a click id's value, never personal data.
 */

export const ATTRIBUTION_SOURCES = [
  'google_ads',
  'google',
  'meta_ads',
  'meta',
  'tiktok',
  'microsoft_ads',
  'utm',
  'referral',
  'direct',
] as const;
export type AttributionSource = (typeof ATTRIBUTION_SOURCES)[number];

/** Hebrew names (the web app shows them through `tr`). `utm` and `referral` show their own name. */
export const attributionSourceLabels: Record<AttributionSource, string> = {
  google_ads: 'Google Ads',
  google: 'גוגל (חיפוש)',
  meta_ads: 'מודעות פייסבוק / אינסטגרם',
  meta: 'פייסבוק / אינסטגרם',
  tiktok: 'TikTok',
  microsoft_ads: 'Microsoft Ads',
  utm: 'קמפיין אחר',
  referral: 'אתר אחר',
  direct: 'ישיר',
};
export const UNKNOWN_SOURCE_LABEL = 'לא ידוע';

export const CLICK_ID_TYPES = ['gclid', 'fbclid', 'ttclid', 'msclkid', 'ctwa'] as const;

const text = (max: number) =>
  z
    .string()
    .trim()
    .transform((v) => v.slice(0, max))
    .optional()
    .catch(undefined);

export const attributionSchema = z.object({
  source: z.enum(ATTRIBUTION_SOURCES),
  /** `utm_source` as given (for `utm`), e.g. "newsletter". */
  utmSource: text(60),
  medium: text(60),
  campaign: text(100),
  term: text(100),
  content: text(100),
  clickIdType: z.enum(CLICK_ID_TYPES).optional().catch(undefined),
  /** Host only, e.g. "www.google.com". */
  referrerHost: text(100),
  /** Path only, no query, e.g. "/about". */
  landingPath: text(100),
  /** Meta ad (Click to WhatsApp / Messenger). */
  adId: text(40),
  adHeadline: text(120),
  seenAt: z.string().datetime(),
});
export type Attribution = z.infer<typeof attributionSchema>;

/** Name to show: the utm_source or referring host when that's what we know. */
export function attributionName(a: Pick<Attribution, 'source' | 'utmSource' | 'referrerHost'>) {
  if (a.source === 'utm' && a.utmSource) return a.utmSource;
  if (a.source === 'referral' && a.referrerHost) return a.referrerHost.replace(/^www\./, '');
  return attributionSourceLabels[a.source];
}

const PAID = /^(cpc|ppc|paid|paidsocial|paid_social|paid-social|cpm|ads?|display|sponsored)$/i;
const hostIs = (host: string, ...names: string[]) =>
  names.some((n) => host === n || host.endsWith(`.${n}`) || host.startsWith(`${n}.`));
const isGoogle = (h: string) => /(^|\.)google\.[a-z.]+$/.test(h);
const isMeta = (h: string) =>
  hostIs(h, 'facebook.com', 'fb.com', 'instagram.com', 'messenger.com') ||
  /(^|\.)(l|lm|m)\.facebook\.com$/.test(h);

export interface AttributionInput {
  /** The landing URL's query parameters. */
  params: Record<string, string | undefined>;
  /** The `Referer` header, if any. */
  referrer?: string | null;
  /** The site's own host — internal navigation isn't a source. */
  selfHost?: string | null;
  landingPath?: string | null;
  now?: Date;
}

/** Names the source of a visit (the table in F26.md). */
export function classifyAttribution({
  params,
  referrer,
  selfHost,
  landingPath,
  now = new Date(),
}: AttributionInput): Attribution {
  const p = (k: string) => {
    const v = params[k]?.trim();
    return v ? v : undefined;
  };
  let referrerHost: string | undefined;
  try {
    referrerHost = referrer ? new URL(referrer).hostname.toLowerCase() : undefined;
  } catch {
    referrerHost = undefined;
  }
  if (referrerHost && selfHost && referrerHost === selfHost.toLowerCase().split(':')[0])
    referrerHost = undefined;

  const utmSource = p('utm_source')?.toLowerCase();
  const medium = p('utm_medium');
  const paid = !!medium && PAID.test(medium);
  const clickIdType =
    p('gclid') || p('gbraid') || p('wbraid')
      ? ('gclid' as const)
      : p('fbclid')
        ? ('fbclid' as const)
        : p('ttclid')
          ? ('ttclid' as const)
          : p('msclkid')
            ? ('msclkid' as const)
            : undefined;

  let source: AttributionSource;
  if (clickIdType === 'gclid' || (utmSource === 'google' && paid)) source = 'google_ads';
  else if (clickIdType === 'ttclid' || utmSource === 'tiktok') source = 'tiktok';
  else if (clickIdType === 'msclkid' || utmSource === 'bing' || utmSource === 'microsoft')
    source = 'microsoft_ads';
  else if (
    (['facebook', 'instagram', 'fb', 'ig', 'meta'].includes(utmSource ?? '') && paid) ||
    (clickIdType === 'fbclid' && paid)
  )
    source = 'meta_ads';
  else if (
    clickIdType === 'fbclid' ||
    ['facebook', 'instagram', 'fb', 'ig', 'meta'].includes(utmSource ?? '')
  )
    // fbclid is added to every outbound Facebook link, ads or not: without a paid medium, it's a post.
    source = 'meta';
  else if (utmSource === 'google') source = 'google';
  else if (utmSource) source = 'utm';
  else if (referrerHost && isGoogle(referrerHost)) source = 'google';
  else if (referrerHost && isMeta(referrerHost)) source = 'meta';
  // Any other site, Bing or TikTok without a click id included: shown by its host.
  else if (referrerHost) source = 'referral';
  else source = 'direct';

  return attributionSchema.parse({
    source,
    utmSource: source === 'utm' ? p('utm_source') : undefined,
    medium,
    campaign: p('utm_campaign'),
    term: p('utm_term'),
    content: p('utm_content'),
    clickIdType,
    referrerHost,
    landingPath: landingPath ? landingPath.split('?')[0] : undefined,
    seenAt: now.toISOString(),
  });
}

/** A visit that came from an ad or a tagged link: it replaces an earlier one (F26). */
export const isCampaignVisit = (a: Attribution) =>
  !!a.clickIdType || !!a.campaign || a.source === 'utm' || !!a.medium;

/** Meta's "Click to WhatsApp" / Messenger ad referral → attribution (only ad names kept). */
export function attributionFromMetaReferral(
  referral: {
    source_id?: unknown;
    ad_id?: unknown;
    headline?: unknown;
    source_type?: unknown;
    ctwa_clid?: unknown;
  },
  now = new Date(),
): Attribution | null {
  const adId = [referral.source_id, referral.ad_id].find((v) => typeof v === 'string') as
    string | undefined;
  // A shared post or a link to the chat also sends a referral; only ads count.
  if (referral.source_type !== 'ad' && referral.ctwa_clid === undefined) return null;
  return attributionSchema.parse({
    source: 'meta_ads',
    clickIdType: referral.ctwa_clid !== undefined ? 'ctwa' : undefined,
    adId,
    adHeadline: typeof referral.headline === 'string' ? referral.headline : undefined,
    seenAt: now.toISOString(),
  });
}
