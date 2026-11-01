import { describe, expect, it } from 'vitest';
import { greeting } from './DashboardPage';

const at = (hour: number, minute = 0) => new Date(2026, 10, 1, hour, minute);

describe('dashboard greeting', () => {
  it('says good morning, afternoon or evening by the local hour', () => {
    expect(greeting(at(5))).toBe('בוקר טוב');
    expect(greeting(at(11, 59))).toBe('בוקר טוב');
    expect(greeting(at(12))).toBe('צהריים טובים');
    expect(greeting(at(16, 59))).toBe('צהריים טובים');
    expect(greeting(at(17))).toBe('ערב טוב');
    expect(greeting(at(23, 30))).toBe('ערב טוב');
    // Late at night is still "ערב טוב" ("לילה טוב" is a goodbye).
    expect(greeting(at(2))).toBe('ערב טוב');
  });
});
