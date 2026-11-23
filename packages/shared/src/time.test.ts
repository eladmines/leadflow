import { describe, expect, it } from 'vitest';
import { dateInZone, nextDate, zonedTimeToUtc } from './time';

describe('time zones (D-199)', () => {
  it('turns a wall-clock time in a zone into an instant, across daylight saving', () => {
    // Israel: UTC+2 in winter, UTC+3 in summer.
    expect(zonedTimeToUtc('2026-11-25', '08:00', 'Asia/Jerusalem').toISOString()).toBe(
      '2026-11-25T06:00:00.000Z',
    );
    expect(zonedTimeToUtc('2026-07-10', '23:59', 'Asia/Jerusalem').toISOString()).toBe(
      '2026-07-10T20:59:00.000Z',
    );
    expect(zonedTimeToUtc('2026-11-25', '08:00', 'America/New_York').toISOString()).toBe(
      '2026-11-25T13:00:00.000Z',
    );
  });

  it('knows which calendar day it is in a zone, and the day after', () => {
    // 22:30 UTC is already the next day in Israel and still the same day in New York.
    const instant = new Date('2026-11-24T22:30:00Z');
    expect(dateInZone(instant, 'Asia/Jerusalem')).toBe('2026-11-25');
    expect(dateInZone(instant, 'America/New_York')).toBe('2026-11-24');
    expect(nextDate('2026-11-30')).toBe('2026-12-01');
    expect(nextDate('2026-12-31')).toBe('2027-01-01');
    expect(nextDate('2028-02-28')).toBe('2028-02-29');
  });
});
