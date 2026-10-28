import { newSection } from '@leadflow/shared';
import { describe, expect, it } from 'vitest';
import { fieldLimit, setSectionField } from './fieldPath';

describe('setSectionField', () => {
  it('sets top-level and item fields, and ignores unknown paths', () => {
    const s = newSection('services', 'svc');
    expect(setSectionField(s, 'title', 'חדש')).toMatchObject({ title: 'חדש' });
    expect(setSectionField(s, 'items.0.name', 'תספורת')).toMatchObject({
      items: [{ name: 'תספורת', description: '' }],
    });
    expect(setSectionField(s, 'items.5.name', 'x')).toBe(s);
    expect(setSectionField(s, 'items.0.nope', 'x')).toBe(s);
    expect(setSectionField(s, 'nope', 'x')).toBe(s);
  });

  it('limits follow the schema', () => {
    expect(fieldLimit('body')).toBe(2000);
    expect(fieldLimit('items.1.name')).toBe(120);
    expect(fieldLimit('items.0.price')).toBe(40);
    expect(fieldLimit('subtitle')).toBe(300);
  });
});
