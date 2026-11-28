/**
 * Wall-clock time in a time zone (the business's, not the browser's: D-199). Used by the API for
 * bookings and by the web for "until the end of the day" of a status.
 */

/** Offset (ms) of a time zone from UTC at a given instant. */
function offsetAt(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant));
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'));
  return asUtc - instant;
}

/**
 * A wall-clock date and time in a time zone (e.g. "2030-01-06", "09:30" in Asia/Jerusalem)
 * as a UTC instant. Two passes handle the daylight-saving switch.
 */
export function zonedTimeToUtc(date: string, time: string, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [h, min] = time.split(':').map(Number) as [number, number];
  const wall = Date.UTC(y, m - 1, d, h, min);
  let guess = wall - offsetAt(wall, timeZone);
  guess = wall - offsetAt(guess, timeZone);
  return new Date(guess);
}

/** `YYYY-MM-DD` of an instant in a time zone. */
export function dateInZone(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/** The calendar day after a `YYYY-MM-DD`. */
export function nextDate(date: string): string {
  return addDays(date, 1);
}

/** Day of the week of a `YYYY-MM-DD` calendar date: 0 = Sunday … 5 = Friday, 6 = Saturday. */
export function weekdayOf(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

/** A `YYYY-MM-DD` moved by `days` calendar days (negative = earlier). */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
