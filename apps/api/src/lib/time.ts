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
