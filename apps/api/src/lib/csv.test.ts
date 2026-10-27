import { describe, expect, it } from 'vitest';
import { csvCell, toCsv } from './csv';

describe('csv', () => {
  it('quotes commas, quotes and newlines; empty for null', () => {
    expect(csvCell('דנה, כהן')).toBe('"דנה, כהן"');
    expect(csvCell('הוא אמר "שלום"')).toBe('"הוא אמר ""שלום"""');
    expect(csvCell('שורה\nשנייה')).toBe('"שורה\nשנייה"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(1500)).toBe('1500');
  });

  it.each(['=HYPERLINK("http://evil","x")', '+972', '-1+2', '@SUM(A1)', '\tx'])(
    'neutralises formula-like cell %j',
    (v) => {
      expect(csvCell(v).replace(/^"/, '').startsWith("'")).toBe(true);
    },
  );

  it('starts with a BOM and uses CRLF', () => {
    const out = toCsv(['שם'], [['דנה']]);
    expect(out.charCodeAt(0)).toBe(0xfeff);
    expect(out).toBe('﻿שם\r\nדנה\r\n');
  });
});
