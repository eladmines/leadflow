import { afterEach, describe, expect, it } from 'vitest';
import { en } from './en';
import { setLocaleForTests, tr } from '.';

afterEach(() => setLocaleForTests('he'));

describe('tr (D-100)', () => {
  it('returns the Hebrew source in Hebrew and the dictionary text in English', () => {
    expect(tr('כל הלידים')).toBe('כל הלידים');
    setLocaleForTests('en');
    expect(tr('כל הלידים')).toBe('All leads');
  });

  it('fills placeholders in either language', () => {
    expect(tr('לפני {0} דקות', 5)).toBe('לפני 5 דקות');
    setLocaleForTests('en');
    expect(tr('לפני {0} דקות', 5)).toBe('5 minutes ago');
  });

  it('translates messages that already carry their values (from the API or validation)', () => {
    setLocaleForTests('en');
    expect(tr('הסיסמה צריכה להכיל לפחות 10 תווים')).toBe(
      'The password must be at least 10 characters',
    );
    expect(tr('הודעה מנועה')).toBe('Message from נועה');
  });

  it('falls back to the source text when a translation is missing', () => {
    setLocaleForTests('en');
    expect(tr('משפט שאין לו תרגום')).toBe('משפט שאין לו תרגום');
  });
});

describe('English dictionary', () => {
  it('has a non-empty English text for every entry, without Hebrew', () => {
    for (const [he, english] of Object.entries(en)) {
      expect(english.trim(), he).not.toBe('');
      expect(/[֐-׿]/.test(english), `${he} → ${english}`).toBe(false);
    }
  });

  it('keeps the same placeholders as the source', () => {
    const marks = (s: string) =>
      [...s.matchAll(/\{(\d+)\}/g)]
        .map((m) => m[1])
        .sort()
        .join(',');
    for (const [he, english] of Object.entries(en)) expect(marks(english), he).toBe(marks(he));
  });
});
