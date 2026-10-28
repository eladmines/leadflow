import { describe, expect, it } from 'vitest';
import { zonedTimeToUtc } from './time';

describe('zonedTimeToUtc', () => {
  it('converts Israel winter (UTC+2) and summer (UTC+3) wall time', () => {
    expect(zonedTimeToUtc('2030-01-06', '09:30', 'Asia/Jerusalem').toISOString()).toBe(
      '2030-01-06T07:30:00.000Z',
    );
    expect(zonedTimeToUtc('2030-07-07', '09:30', 'Asia/Jerusalem').toISOString()).toBe(
      '2030-07-07T06:30:00.000Z',
    );
  });
});
