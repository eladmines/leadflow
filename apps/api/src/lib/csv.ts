/**
 * CSV for spreadsheets: UTF-8 with a BOM (so Excel shows Hebrew), CRLF rows, RFC 4180 quoting.
 * Cells starting with = + - @ tab or CR are prefixed with ' so Excel never runs them as formulas
 * (CSV injection: a lead could type `=HYPERLINK(...)` into the website form).
 */
const FORMULA_START = /^[=+\-@\t\r]/;
/** Byte-order mark: tells Excel the file is UTF-8 (otherwise Hebrew shows as gibberish). */
const BOM = String.fromCharCode(0xfeff);

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (FORMULA_START.test(s)) s = `'${s}`;
  return /[",\r\n']/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  const lines = [header, ...rows].map((r) => r.map(csvCell).join(','));
  return `${BOM}${lines.join('\r\n')}\r\n`;
}
