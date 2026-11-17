import { describe, expect, it } from 'vitest';
import { migrateStorage } from './migrateStorage';

describe('migrateStorage (D-181)', () => {
  it('moves the old leadflow keys to simplecatch and keeps newer values', () => {
    localStorage.clear();
    localStorage.setItem('leadflow.locale', 'he');
    localStorage.setItem('leadflow.tour.v1:u1', '1');
    localStorage.setItem('leadflow:site-draft:b1', '{"x":1}');
    localStorage.setItem('leadflow.helper.hello', 'old');
    localStorage.setItem('simplecatch.helper.hello', 'new');
    localStorage.setItem('other', 'keep');

    migrateStorage(localStorage);

    expect(localStorage.getItem('simplecatch.locale')).toBe('he');
    expect(localStorage.getItem('simplecatch.tour.v1:u1')).toBe('1');
    expect(localStorage.getItem('simplecatch:site-draft:b1')).toBe('{"x":1}');
    expect(localStorage.getItem('simplecatch.helper.hello')).toBe('new');
    expect(localStorage.getItem('leadflow.locale')).toBeNull();
    expect(localStorage.getItem('leadflow.helper.hello')).toBeNull();
    expect(localStorage.getItem('other')).toBe('keep');
  });

  it('does nothing without storage', () => {
    expect(() => migrateStorage(undefined)).not.toThrow();
  });
});
