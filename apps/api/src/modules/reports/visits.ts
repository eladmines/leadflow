import type { PrismaClient } from '@prisma/client';
import { attributionName, type Attribution } from '@simplecatch/shared';

/**
 * F31 — website visits as counts: per business, local day, source, name and campaign. No visitor id,
 * no IP, no page list. Fed by SimpleCatch sites and by the embed script on other websites.
 */

const BOT =
  /bot|crawl|spider|slurp|preview|monitor|headless|lighthouse|pingdom|uptime|curl|wget|python|java\/|go-http|axios|node-fetch|facebookexternalhit|whatsapp/i;

/** Crawlers and link checkers don't count as visitors (no user agent is a bot too). */
export const isBotAgent = (ua: string | undefined) => !ua || BOT.test(ua);

/** Distinct source/campaign combinations kept per business per day (a guard against junk tags). */
const MAX_ROWS_PER_DAY = 300;

/** What a visit is counted under: the same names the lead report uses (F26). */
function visitKey(a: Attribution) {
  const named = a.source === 'utm' || a.source === 'referral';
  return {
    source: a.source,
    name: (named ? attributionName(a) : '').slice(0, 100),
    campaign: (a.campaign ?? a.adHeadline ?? '').slice(0, 100),
  };
}

export const localDay = (timezone: string, now: Date) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);

export async function recordVisit(
  prisma: PrismaClient,
  businessId: string,
  timezone: string,
  attribution: Attribution,
  now = new Date(),
) {
  const { source, name, campaign } = visitKey(attribution);
  const day = localDay(timezone, now);
  await prisma.$executeRaw`
    INSERT INTO visit_counts (business_id, day, source, name, campaign, count)
    SELECT ${businessId}::uuid, ${day}, ${source}, ${name}, ${campaign}, 1
    WHERE (SELECT count(*) FROM visit_counts WHERE business_id = ${businessId}::uuid AND day = ${day}) < ${MAX_ROWS_PER_DAY}
      OR EXISTS (
        SELECT 1 FROM visit_counts
        WHERE business_id = ${businessId}::uuid AND day = ${day}
          AND source = ${source} AND name = ${name} AND campaign = ${campaign}
      )
    ON CONFLICT (business_id, day, source, name, campaign)
    DO UPDATE SET count = visit_counts.count + 1`;
}
