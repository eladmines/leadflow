import { describe, expect, it } from 'vitest';
import { formatIsraeliPhone, normalizePhone, phoneSchema, splitPhone } from './business';

describe('international phone numbers (D-121)', () => {
  it('keeps Israeli local forms working, by default and with IL', () => {
    expect(normalizePhone('050-1234567')).toBe('+972501234567');
    expect(normalizePhone('03-1234567', 'IL')).toBe('+97231234567');
    expect(normalizePhone('+972 50 123 4567')).toBe('+972501234567');
    expect(normalizePhone('+972 050-1234567')).toBe('+972501234567');
    expect(normalizePhone('050-12345')).toBeNull();
  });

  it('accepts other countries with their code, dropping a trunk 0', () => {
    expect(normalizePhone('+44 7700 900123')).toBe('+447700900123');
    expect(normalizePhone('+44 07700 900123')).toBe('+447700900123');
    expect(normalizePhone('0044 7700 900123')).toBe('+447700900123');
    expect(normalizePhone('+1 (212) 555-0199')).toBe('+12125550199');
    expect(normalizePhone('+49 30 1234567')).toBe('+49301234567');
  });

  it('reads a local number in the chosen country', () => {
    expect(normalizePhone('07700 900123', 'GB')).toBe('+447700900123');
    expect(normalizePhone('212-555-0199', 'US')).toBe('+12125550199');
  });

  it('rejects unknown codes, letters and wrong lengths', () => {
    expect(normalizePhone('+999 1234567')).toBeNull();
    expect(normalizePhone('+44 123')).toBeNull();
    expect(normalizePhone('+44 1234567890123')).toBeNull();
    expect(normalizePhone('call me')).toBeNull();
  });

  it('splits for editing and formats for display', () => {
    expect(splitPhone('+972501234567')).toEqual({ country: 'IL', national: '050-1234567' });
    expect(splitPhone('+447700900123')).toEqual({ country: 'GB', national: '7700900123' });
    expect(splitPhone('+12125550199')).toEqual({ country: 'US', national: '2125550199' });
    expect(splitPhone(null)).toEqual({ country: null, national: '' });
    expect(formatIsraeliPhone('+447700900123')).toBe('+44 7700900123');
    expect(formatIsraeliPhone('+972501234567')).toBe('050-1234567');
  });

  it('the shared schema takes international numbers', () => {
    expect(phoneSchema.parse('+44 7700 900123')).toBe('+447700900123');
    expect(phoneSchema.safeParse('+44 12').success).toBe(false);
  });
});
