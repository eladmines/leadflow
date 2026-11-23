import type { PrismaClient } from '@prisma/client';
import {
  normalizeCtaName,
  normalizePagePath,
  sectionLabel,
  type BehaviorEvent,
} from '@simplecatch/shared';

/**
 * F32 — what visitors do on a website with the embed script, as counts: business × local day ×
 * kind × label. No visitor id, no IP, no sequence of pages. Labels are checked per kind, so a
 * caller can't store free text other than a page path.
 */

/** Distinct kind/label combinations kept per business per day (a guard against junk page paths). */
const MAX_ROWS_PER_DAY = 500;

const ONE_OF: Partial<Record<BehaviorEvent, readonly string[]>> = {
  device: ['mobile', 'tablet', 'desktop'],
  click: ['phone', 'whatsapp', 'email'],
  scroll: ['50', '90'],
  form: ['start'],
};

/** The device class from the user agent (a site without the script can't read the window width). */
export const deviceOf = (ua: string | undefined): 'mobile' | 'tablet' | 'desktop' =>
  /ipad|tablet|kindle|silk|playbook/i.test(ua ?? '') ||
  (/android/i.test(ua ?? '') && !/mobile/i.test(ua ?? ''))
    ? 'tablet'
    : /mobi|iphone|ipod|android|windows phone/i.test(ua ?? '')
      ? 'mobile'
      : 'desktop';

/** The label to store, or null when the event isn't acceptable. */
export function eventLabel(kind: BehaviorEvent, label: string | undefined): string | null {
  if (kind === 'page' || kind === 'landing') return normalizePagePath(label);
  if (kind === 'cta') return normalizeCtaName(label) || null;
  if (kind === 'section' || kind === 'sclick') {
    // `<path>#<name>`: rebuilt from its parts, so the stored label is always clean and short.
    const at = (label ?? '').indexOf('#');
    return at < 0 ? null : sectionLabel(label!.slice(0, at), label!.slice(at + 1)) || null;
  }
  const allowed = ONE_OF[kind];
  return allowed && label !== undefined && allowed.includes(label) ? label : null;
}

export async function recordEvents(
  prisma: PrismaClient,
  businessId: string,
  day: string,
  events: { k: BehaviorEvent; l?: string }[],
) {
  for (const e of events) {
    const label = eventLabel(e.k, e.l);
    if (label === null) continue;
    await prisma.$executeRaw`
      INSERT INTO event_counts (business_id, day, kind, label, count)
      SELECT ${businessId}::uuid, ${day}, ${e.k}, ${label}, 1
      WHERE (SELECT count(*) FROM event_counts WHERE business_id = ${businessId}::uuid AND day = ${day}) < ${MAX_ROWS_PER_DAY}
        OR EXISTS (
          SELECT 1 FROM event_counts
          WHERE business_id = ${businessId}::uuid AND day = ${day} AND kind = ${e.k} AND label = ${label}
        )
      ON CONFLICT (business_id, day, kind, label)
      DO UPDATE SET count = event_counts.count + 1`;
  }
}
