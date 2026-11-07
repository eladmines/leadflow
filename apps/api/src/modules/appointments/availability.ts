import {
  BLOCKING_STATUSES,
  defaultOpeningHours,
  openingHoursSchema,
  WEEKDAYS,
  type OpeningHours,
} from '@leadflow/shared';
import type { Db } from '../../lib/db';
import { zonedTimeToUtc } from '../../lib/time';

/**
 * Free times for booking (D-102), on the server, in the business's time zone. A start time is free
 * when the whole appointment fits inside that day's opening hours, it is far enough ahead, and at
 * least one active team member has no REQUESTED/CONFIRMED appointment overlapping it — the same
 * rule the clash check applies when booking.
 */

const SLOT_STEP_MIN = 30;
/** How soon a customer can book (minutes from now). */
const MIN_NOTICE_MIN = 60;

export interface FreeTime {
  /** HH:MM, wall clock in the business's time zone. */
  time: string;
  startsAt: Date;
  /** A team member who is free then (the least busy that day). */
  staffId: string;
}

interface Business {
  id: string;
  timezone: string;
  openingHours: unknown;
}

const pad = (n: number) => String(n).padStart(2, '0');
const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const toHhmm = (min: number) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;

/** Today's date (YYYY-MM-DD) in a time zone. */
export function todayIn(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(now);
}

export function addDaysTo(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

function hoursOf(business: Business): OpeningHours {
  const parsed = openingHoursSchema.safeParse(business.openingHours);
  return parsed.success ? parsed.data : defaultOpeningHours;
}

/** Opening hours of a date, in minutes from midnight; null when closed. */
function dayHours(hours: OpeningHours, date: string) {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const h = hours[WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]!];
  return h?.open ? { from: toMin(h.from), to: toMin(h.to) } : null;
}

/** Free start times for each date in `dates`, using one query for the whole range. */
export async function freeTimes(
  db: Db,
  business: Business,
  dates: string[],
  durationMin: number,
  now = new Date(),
): Promise<Map<string, FreeTime[]>> {
  const out = new Map<string, FreeTime[]>(dates.map((d) => [d, []]));
  if (!dates.length) return out;
  const hours = hoursOf(business);
  const tz = business.timezone;
  const staff = (
    await db.membership.findMany({
      where: { businessId: business.id, status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
      select: { userId: true },
    })
  ).map((m) => m.userId);
  if (!staff.length) return out;

  const rangeStart = zonedTimeToUtc(dates[0]!, '00:00', tz);
  const rangeEnd = zonedTimeToUtc(addDaysTo(dates.at(-1)!, 1), '00:00', tz);
  const booked = await db.appointment.findMany({
    where: {
      businessId: business.id,
      staffId: { in: staff },
      status: { in: BLOCKING_STATUSES },
      startsAt: { lt: rangeEnd },
      endsAt: { gt: rangeStart },
    },
    select: { staffId: true, startsAt: true, endsAt: true },
  });
  const earliest = now.getTime() + MIN_NOTICE_MIN * 60_000;

  for (const date of dates) {
    const open = dayHours(hours, date);
    if (!open) continue;
    const dayStart = zonedTimeToUtc(date, '00:00', tz).getTime();
    const dayEnd = zonedTimeToUtc(addDaysTo(date, 1), '00:00', tz).getTime();
    const load = new Map(staff.map((s) => [s, 0]));
    for (const b of booked) {
      if (b.startsAt.getTime() < dayEnd && b.endsAt.getTime() > dayStart) {
        load.set(b.staffId!, (load.get(b.staffId!) ?? 0) + 1);
      }
    }
    const byLoad = [...staff].sort((a, b) => load.get(a)! - load.get(b)!);
    const list = out.get(date)!;
    for (let m = open.from; m + durationMin <= open.to; m += SLOT_STEP_MIN) {
      const startsAt = zonedTimeToUtc(date, toHhmm(m), tz);
      const start = startsAt.getTime();
      if (start < earliest) continue;
      const end = start + durationMin * 60_000;
      const staffId = byLoad.find(
        (s) =>
          !booked.some(
            (b) => b.staffId === s && b.startsAt.getTime() < end && b.endsAt.getTime() > start,
          ),
      );
      if (staffId) list.push({ time: toHhmm(m), startsAt, staffId });
    }
  }
  return out;
}
