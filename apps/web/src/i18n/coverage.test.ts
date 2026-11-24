import { afterEach, expect, it } from 'vitest';
import { setLocaleForTests, tr } from '.';

afterEach(() => setLocaleForTests('he'));

const sources = import.meta.glob(['../**/*.ts', '../**/*.tsx', '!../**/*.test.*', '!../test/**'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const HEBREW = /[֐-׿]/;
// tr('literal') or tr("literal"), possibly on the next line; template strings are built from parts.
const CALL = /\btr\(\s*(?:'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)")/g;

it('has an English text for every Hebrew literal passed to tr()', () => {
  setLocaleForTests('en');
  const missing: string[] = [];
  for (const [file, text] of Object.entries(sources)) {
    for (const m of text.matchAll(CALL)) {
      const key = (m[1] ?? m[2] ?? '').replace(/\\'/g, "'").replace(/\\"/g, '"');
      if (HEBREW.test(key) && HEBREW.test(tr(key))) missing.push(`${file}: ${key}`);
    }
  }
  expect(missing).toEqual([]);
});
