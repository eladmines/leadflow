import readXlsxFile from 'read-excel-file';
import { tr } from '../../i18n';

/** A spreadsheet as text: the header row, and the rows below it with their line in the file. */
export interface Sheet {
  headers: string[];
  rows: string[][];
  /** The line number in the file (header = 1) of each row, for messages like "row 7: …". */
  lines: number[];
}

export class SheetError extends Error {}

const cell = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).trim();
};

function toSheet(all: string[][]): Sheet {
  const keep = all
    .map((cells, i) => ({ cells, line: i + 1 }))
    .filter((r) => r.cells.some((c) => c !== ''));
  const [head, ...body] = keep;
  if (!head || body.length === 0)
    throw new SheetError(tr('בקובץ צריכה להיות שורת כותרות ולפחות שורה אחת של לקוח.'));
  const width = Math.max(...keep.map((r) => r.cells.length));
  const pad = (cells: string[]) => Array.from({ length: width }, (_, i) => cells[i] ?? '');
  return {
    headers: pad(head.cells).map((h, i) => h || `${tr('עמודה')} ${i + 1}`),
    rows: body.map((r) => pad(r.cells)),
    lines: body.map((r) => r.line),
  };
}

const BOM = String.fromCharCode(0xfeff);

/** UTF-8 (with or without BOM); a file saved by older Hebrew Excel as "CSV" is Windows-1255. */
function decode(buffer: ArrayBuffer): string {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    text = new TextDecoder('windows-1255').decode(buffer);
  }
  return text.startsWith(BOM) ? text.slice(1) : text;
}

/** Comma, semicolon (Hebrew Excel's default) or tab: whichever the first line uses most. */
function delimiterOf(text: string): string {
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  const count = (d: string) => first.split(d).length - 1;
  return [',', ';', '\t'].reduce((best, d) => (count(d) > count(best) ? d : best), ',');
}

/** A small RFC 4180 reader: quoted cells, doubled quotes, line breaks inside quotes. */
export function parseCsv(text: string): string[][] {
  const delimiter = delimiterOf(text);
  const out: string[][] = [];
  let row: string[] = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          value += '"';
          i++;
        } else quoted = false;
      } else value += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      row.push(value.trim());
      value = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(value.trim());
      out.push(row);
      row = [];
      value = '';
    } else value += ch;
  }
  if (value !== '' || row.length > 0) {
    row.push(value.trim());
    out.push(row);
  }
  return out;
}

function readBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(new SheetError(tr('לא הצלחנו לקרוא את הקובץ.')));
    reader.readAsArrayBuffer(file);
  });
}

/** Reads the first sheet of an .xlsx file or a .csv file. */
export async function readSheet(file: File): Promise<Sheet> {
  const name = file.name.toLowerCase();
  try {
    if (name.endsWith('.xlsx')) {
      const rows = await readXlsxFile(await readBuffer(file));
      return toSheet(rows.map((r) => r.map(cell)));
    }
    if (name.endsWith('.csv') || name.endsWith('.txt')) {
      return toSheet(parseCsv(decode(await readBuffer(file))).map((r) => r.map(cell)));
    }
  } catch (err) {
    if (err instanceof SheetError) throw err;
    throw new SheetError(tr('לא הצלחנו לקרוא את הקובץ. בדקו שהוא תקין ונסו לשמור אותו מחדש.'));
  }
  throw new SheetError(
    name.endsWith('.xls')
      ? tr('קובצי xls ישנים לא נתמכים. שמרו את הקובץ כ־xlsx (קובץ ← שמירה בשם) ונסו שוב.')
      : tr('אפשר להעלות קובץ Excel (xlsx) או CSV.'),
  );
}

export const FIELDS = ['name', 'phone', 'email', 'value'] as const;
export type Field = (typeof FIELDS)[number];

const HINTS: Record<Field, string[]> = {
  phone: ['טלפון', 'נייד', 'פלאפון', 'סלולר', 'phone', 'mobile', 'cell', 'tel'],
  email: ['מייל', 'אימייל', 'דואל', 'דוא"ל', 'email', 'e-mail', 'mail'],
  value: ['סכום', 'מחיר', 'שווי', 'ערך', 'עסקה', 'value', 'amount', 'price', 'total'],
  name: ['שם', 'לקוח', 'name', 'customer', 'client'],
};

/** The column (index) each field most likely lives in, judged by the header text. */
export function guessColumns(headers: string[]): Record<Field, number | null> {
  const result: Record<Field, number | null> = {
    name: null,
    phone: null,
    email: null,
    value: null,
  };
  const taken = new Set<number>();
  // Most specific first, so "שם" doesn't claim "מייל של איש קשר" and the like.
  for (const field of ['phone', 'email', 'value', 'name'] as const) {
    const at = headers.findIndex(
      (h, i) =>
        !taken.has(i) && HINTS[field].some((hint) => h.toLowerCase().includes(hint.toLowerCase())),
    );
    if (at >= 0) {
      result[field] = at;
      taken.add(at);
    }
  }
  return result;
}

/** Excel drops a leading zero from a phone typed as a number: 521234567 → 0521234567. */
export const fixPhone = (v: string) => (/^5\d{8}$/.test(v) ? `0${v}` : v);

/** A ready-to-fill CSV (UTF-8 with BOM, so Excel opens Hebrew correctly). */
export function templateCsv(): string {
  const rows = [
    [tr('שם'), tr('טלפון'), tr('אימייל'), tr('סכום')],
    [tr('דנה כהן'), '052-1234567', 'dana@example.com', '1500'],
  ];
  return `${BOM}${rows.map((r) => r.join(',')).join('\r\n')}\r\n`;
}
