import { describe, expect, it } from 'vitest';
import {
  createBusinessRequestSchema,
  defaultOpeningHours,
  formatIsraeliPhone,
  normalizeIsraeliPhone,
  openingHoursSchema,
  updateBusinessRequestSchema,
} from './business';
import { can } from './permissions';

describe('normalizeIsraeliPhone', () => {
  it.each([
    ['050-1234567', '+972501234567'],
    ['0501234567', '+972501234567'],
    ['+972 50 123 4567', '+972501234567'],
    ['972-50-1234567', '+972501234567'],
    ['+972-0-50-1234567', '+972501234567'],
    ['03-1234567', '+97231234567'],
    ['(04) 123-4567', '+97241234567'],
    ['077-1234567', '+972771234567'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeIsraeliPhone(input)).toBe(expected);
  });

  it.each([
    '',
    '12345',
    '050-123456',
    '050-12345678',
    '+1 212 555 0100',
    '01-1234567',
    'abc',
    '+0501234567',
  ])('rejects %j', (input) => {
    expect(normalizeIsraeliPhone(input)).toBeNull();
  });

  it('formats E.164 back to local form', () => {
    expect(formatIsraeliPhone('+972501234567')).toBe('050-1234567');
    expect(formatIsraeliPhone('+97231234567')).toBe('03-1234567');
  });
});

describe('opening hours', () => {
  it('accepts the default week', () => {
    expect(openingHoursSchema.safeParse(defaultOpeningHours).success).toBe(true);
  });

  it('rejects an open day that closes before it opens, with a Hebrew message on "to"', () => {
    const r = openingHoursSchema.safeParse({
      ...defaultOpeningHours,
      sun: { open: true, from: '18:00', to: '09:00' },
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(['sun', 'to']);
    expect(r.error?.issues[0]?.message).toMatch(/[֐-׿]/);
  });

  it('ignores the range on a closed day and rejects malformed times', () => {
    const closed = { ...defaultOpeningHours, sat: { open: false, from: '18:00', to: '09:00' } };
    expect(openingHoursSchema.safeParse(closed).success).toBe(true);
    const bad = { ...defaultOpeningHours, mon: { open: true, from: '9:00', to: '18:00' } };
    expect(openingHoursSchema.safeParse(bad).success).toBe(false);
  });
});

describe('business requests', () => {
  it('create: trims the name and requires a known industry', () => {
    expect(
      createBusinessRequestSchema.parse({ name: '  מספרת שירן ', industry: 'beauty' }),
    ).toEqual({
      name: 'מספרת שירן',
      industry: 'beauty',
    });
    expect(createBusinessRequestSchema.safeParse({ name: 'א', industry: 'beauty' }).success).toBe(
      false,
    );
    expect(createBusinessRequestSchema.safeParse({ name: 'מוסך', industry: 'bank' }).success).toBe(
      false,
    );
  });

  it('update: normalises phone and address, de-duplicates areas, strips unknown keys', () => {
    const parsed = updateBusinessRequestSchema.parse({
      phone: '050-1234567',
      address: '   ',
      serviceAreas: ['חיפה', ' יקנעם ', 'חיפה'],
      status: 'ACTIVE',
      businessId: 'x',
    });
    expect(parsed).toEqual({
      phone: '+972501234567',
      address: null,
      serviceAreas: ['חיפה', 'יקנעם'],
    });
  });
});

describe('permissions', () => {
  it('only the owner can update the business; managers can view members, employees cannot', () => {
    expect(can('OWNER', 'business.update')).toBe(true);
    expect(can('MANAGER', 'business.update')).toBe(false);
    expect(can('EMPLOYEE', 'business.update')).toBe(false);
    expect(can('MANAGER', 'members.view')).toBe(true);
    expect(can('EMPLOYEE', 'members.view')).toBe(false);
    expect(can('EMPLOYEE', 'business.view')).toBe(true);
  });
});
