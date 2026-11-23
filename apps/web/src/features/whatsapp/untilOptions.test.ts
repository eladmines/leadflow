import { describe, expect, it } from 'vitest';
import { untilOptions } from './AutoReplyCard';

const at = (key: string, tz: string, now: string) =>
  untilOptions(tz, new Date(now))
    .find((o) => o.key === key)!
    .until!.toISOString();

describe('status end times, in the business time zone (D-199)', () => {
  // 22:30 UTC: already the 25th, 00:30, in Israel; still the 24th, 17:30, in New York.
  const now = '2026-11-24T22:30:00Z';

  it("end of the day and tomorrow morning are the business's, whatever the device", () => {
    expect(at('eod', 'Asia/Jerusalem', now)).toBe('2026-11-25T21:59:00.000Z'); // 25th 23:59 local
    expect(at('tomorrow', 'Asia/Jerusalem', now)).toBe('2026-11-26T06:00:00.000Z'); // 26th 08:00 local
    expect(at('eod', 'America/New_York', now)).toBe('2026-11-25T04:59:00.000Z'); // 24th 23:59 local
    expect(at('tomorrow', 'America/New_York', now)).toBe('2026-11-25T13:00:00.000Z'); // 25th 08:00 local
  });

  it('follows daylight saving, and hours are plain hours', () => {
    expect(at('eod', 'Asia/Jerusalem', '2026-07-10T10:00:00Z')).toBe('2026-07-10T20:59:00.000Z');
    expect(at('1h', 'Asia/Jerusalem', now)).toBe('2026-11-24T23:30:00.000Z');
    expect(at('3h', 'America/New_York', now)).toBe('2026-11-25T01:30:00.000Z');
    expect(untilOptions('Asia/Jerusalem', new Date(now))[0]).toMatchObject({ until: null });
  });
});
