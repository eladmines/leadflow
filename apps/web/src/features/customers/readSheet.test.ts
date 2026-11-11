import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fixPhone, guessColumns, parseCsv, readSheet, SheetError } from './readSheet';

const fixture = (name: string) =>
  readFileSync(join(process.cwd(), 'src/features/customers/fixtures', name));

describe('reading a spreadsheet', () => {
  it('reads an Excel file: header, rows, and numbers as text', async () => {
    const sheet = await readSheet(new File([fixture('customers.xlsx')], 'customers.xlsx'));
    expect(sheet.headers).toEqual(['שם', 'טלפון', 'אימייל', 'סכום']);
    expect(sheet.rows).toEqual([
      ['דנה כהן', '521234567', 'dana@example.com', '1500'],
      ['יוסי לוי', '052-7654321', '', ''],
    ]);
    expect(sheet.lines).toEqual([2, 3]);
    // Excel dropped the leading zero of the first phone.
    expect(fixPhone(sheet.rows[0]![1]!)).toBe('0521234567');
  });

  it('reads CSV with commas, semicolons, quotes and a BOM, and skips empty lines', async () => {
    const csv = '﻿name,phone\n"Cohen, Dana","052-1111111"\n\n"He said ""hi""",0522222222\n';
    const sheet = await readSheet(new File([csv], 'a.csv'));
    expect(sheet.rows).toEqual([
      ['Cohen, Dana', '052-1111111'],
      ['He said "hi"', '0522222222'],
    ]);
    expect(sheet.lines).toEqual([2, 4]);
    expect(parseCsv('a;b\n1;2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('reads a Windows-1255 CSV (older Hebrew Excel)', async () => {
    // "שם" in Windows-1255 is 0xF9 0xE1 ... build "שם;טלפון" and one row.
    const cp1255 = (s: string) =>
      Uint8Array.from(
        [...s].map((ch) => {
          const code = ch.charCodeAt(0);
          return code >= 0x05d0 && code <= 0x05ea ? code - 0x05d0 + 0xe0 : code;
        }),
      );
    const sheet = await readSheet(
      new File([cp1255('שם;טלפון\nדנה;0521111111\n')], 'old.csv', { type: 'text/csv' }),
    );
    expect(sheet.headers).toEqual(['שם', 'טלפון']);
    expect(sheet.rows).toEqual([['דנה', '0521111111']]);
  });

  it('rejects a file with no customers, an old .xls and other types', async () => {
    await expect(readSheet(new File(['שם;טלפון\n'], 'e.csv'))).rejects.toBeInstanceOf(SheetError);
    await expect(readSheet(new File(['x'], 'old.xls'))).rejects.toThrow(/xlsx/);
    await expect(readSheet(new File(['x'], 'photo.png'))).rejects.toBeInstanceOf(SheetError);
  });

  it('matches columns by their headers, in Hebrew and English', () => {
    expect(guessColumns(['שם מלא', 'נייד', 'דוא"ל', 'סכום עסקה'])).toEqual({
      name: 0,
      phone: 1,
      email: 2,
      value: 3,
    });
    expect(guessColumns(['Customer', 'Mobile', 'E-mail', 'Amount'])).toEqual({
      name: 0,
      phone: 1,
      email: 2,
      value: 3,
    });
    expect(guessColumns(['a', 'b'])).toEqual({ name: null, phone: null, email: null, value: null });
  });
});
