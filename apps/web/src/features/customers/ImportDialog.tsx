import { IMPORT_MAX_ROWS, type ImportCustomersResponse } from '@leadflow/shared';
import { CheckCircle2, FileSpreadsheet, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { Alert, Button, DialogShell, SelectMenu } from '../../components/ui';
import { tr } from '../../i18n';
import { errorMessage } from '../auth/serverErrors';
import { useCurrentBusiness } from '../shell/CurrentBusiness';
import { useImportCustomers } from './api';
import {
  fixPhone,
  guessColumns,
  readSheet,
  SheetError,
  templateCsv,
  type Field,
  type Sheet,
} from './readSheet';

type Mapping = Record<Field, string>;

const fieldLabels: Record<Field, () => string> = {
  name: () => tr('שם'),
  phone: () => tr('טלפון'),
  email: () => tr('אימייל'),
  value: () => tr('סכום'),
};

const previewRows = 3;

/**
 * Import customers from Excel or CSV (D-179). The file is read here in the browser: pick it, check
 * which column is which, then send. Each row becomes a customer (a contact with a lead in "Won").
 */
export function ImportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const business = useCurrentBusiness();
  const importCustomers = useImportCustomers(business.id);
  const fileInput = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [mapping, setMapping] = useState<Mapping>({ name: '', phone: '', email: '', value: '' });
  const [readError, setReadError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportCustomersResponse | null>(null);

  const reset = () => {
    setFileName('');
    setSheet(null);
    setReadError(null);
    setResult(null);
    importCustomers.reset();
  };
  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) reset();
  };

  async function onFile(file: File | undefined) {
    if (!file) return;
    setReadError(null);
    try {
      const read = await readSheet(file);
      const guess = guessColumns(read.headers);
      setSheet(read);
      setFileName(file.name);
      setMapping({
        name: guess.name === null ? '' : String(guess.name),
        phone: guess.phone === null ? '' : String(guess.phone),
        email: guess.email === null ? '' : String(guess.email),
        value: guess.value === null ? '' : String(guess.value),
      });
    } catch (err) {
      setSheet(null);
      setReadError(err instanceof SheetError ? err.message : tr('לא הצלחנו לקרוא את הקובץ.'));
    }
  }

  const pick = (row: string[], field: Field) =>
    mapping[field] === '' ? '' : (row[Number(mapping[field])] ?? '');
  const tooMany = (sheet?.rows.length ?? 0) > IMPORT_MAX_ROWS;
  const ready =
    sheet !== null &&
    mapping.name !== '' &&
    (mapping.phone !== '' || mapping.email !== '') &&
    !tooMany;

  function send() {
    if (!sheet) return;
    importCustomers.mutate(
      {
        rows: sheet.rows.map((row) => ({
          name: pick(row, 'name'),
          phone: fixPhone(pick(row, 'phone')),
          email: pick(row, 'email'),
          value: pick(row, 'value'),
        })),
      },
      { onSuccess: setResult },
    );
  }

  const downloadTemplate = () => {
    const url = URL.createObjectURL(new Blob([templateCsv()], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'leadflow-customers-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <DialogShell open={open} onOpenChange={close} title={tr('ייבוא לקוחות מ־Excel')} wide>
      {result ? (
        <Result result={result} lines={sheet?.lines ?? []} onClose={() => close(false)} />
      ) : !sheet ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-ink-muted">
            {tr(
              'מעלים קובץ Excel (xlsx) או CSV. השורה הראשונה היא כותרות, ולכל לקוח שורה עם שם, וטלפון או אימייל. סכום הוא אופציונלי.',
            )}
          </p>
          {readError && <Alert tone="danger">{readError}</Alert>}
          <input
            ref={fileInput}
            type="file"
            accept=".xlsx,.csv,.txt"
            aria-label={tr('בחירת קובץ')}
            className="sr-only"
            onChange={(e) => {
              void onFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => fileInput.current?.click()}>
              <Upload aria-hidden className="h-4 w-4" />
              {tr('בחירת קובץ')}
            </Button>
            <Button variant="ghost" onClick={downloadTemplate}>
              <FileSpreadsheet aria-hidden className="h-4 w-4" />
              {tr('הורדת תבנית')}
            </Button>
          </div>
          <p className="text-xs text-ink-muted">
            {tr('עד {0} שורות בכל פעם. מי שכבר קיים כלקוח לא ייווצר פעמיים.', IMPORT_MAX_ROWS)}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <p className="text-sm text-ink-muted">
            <bdi dir="ltr" className="font-medium text-ink">
              {fileName}
            </bdi>
            {' · '}
            {tr('{0} שורות', sheet.rows.length)}{' '}
            <button
              type="button"
              onClick={reset}
              className="font-medium text-brand-700 hover:underline"
            >
              {tr('קובץ אחר')}
            </button>
          </p>
          {tooMany && (
            <Alert tone="danger">
              {tr('בקובץ יש יותר מ־{0} שורות. פצלו אותו לכמה קבצים.', IMPORT_MAX_ROWS)}
            </Alert>
          )}
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-1 text-sm font-medium text-ink">
              {tr('איזו עמודה היא איזה פרט?')}
            </legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {(['name', 'phone', 'email', 'value'] as const).map((field) => (
                <SelectMenu
                  key={field}
                  label={fieldLabels[field]()}
                  required={field === 'name'}
                  searchable={false}
                  placeholder={tr('בחירת עמודה')}
                  value={mapping[field]}
                  onChange={(v) => setMapping((m) => ({ ...m, [field]: v }))}
                  options={[
                    ...(field === 'name' ? [] : [{ value: '', label: tr('לא לייבא') }]),
                    ...sheet.headers.map((h, i) => ({ value: String(i), label: h })),
                  ]}
                />
              ))}
            </div>
            {(mapping.name === '' || (mapping.phone === '' && mapping.email === '')) && (
              <p className="text-sm text-ink-muted">
                {tr('חובה לבחור עמודה לשם, ולפחות עמודה אחת לטלפון או לאימייל.')}
              </p>
            )}
          </fieldset>

          <div className="overflow-x-auto rounded-xl border border-surface-border">
            <table className="w-full text-start text-sm">
              <caption className="sr-only">{tr('תצוגה מקדימה')}</caption>
              <thead className="bg-surface-muted text-ink-muted">
                <tr>
                  {(['name', 'phone', 'email', 'value'] as const).map((f) => (
                    <th key={f} scope="col" className="px-3 py-2 text-start font-medium">
                      {fieldLabels[f]()}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sheet.rows.slice(0, previewRows).map((row, i) => (
                  <tr key={i} className="border-t border-surface-border">
                    {(['name', 'phone', 'email', 'value'] as const).map((f) => (
                      <td key={f} className="px-3 py-2" dir={f === 'name' ? 'auto' : 'ltr'}>
                        {f === 'phone' ? fixPhone(pick(row, f)) : pick(row, f) || '—'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {importCustomers.isError && (
            <Alert tone="danger">{errorMessage(importCustomers.error)}</Alert>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => close(false)}>
              {tr('ביטול')}
            </Button>
            <Button disabled={!ready} loading={importCustomers.isPending} onClick={send}>
              {tr('ייבוא {0} לקוחות', sheet.rows.length)}
            </Button>
          </div>
        </div>
      )}
    </DialogShell>
  );
}

function Result({
  result,
  lines,
  onClose,
}: {
  result: ImportCustomersResponse;
  lines: number[];
  onClose: () => void;
}) {
  const shown = result.invalid.slice(0, 10);
  return (
    <div className="flex flex-col gap-4">
      <div role="status" className="flex items-start gap-3">
        <CheckCircle2 aria-hidden className="mt-0.5 h-6 w-6 shrink-0 text-emerald-600" />
        <div className="flex flex-col gap-1">
          <p className="font-semibold text-ink">{tr('יובאו {0} לקוחות', result.imported)}</p>
          {result.duplicates > 0 && (
            <p className="text-sm text-ink-muted">
              {tr('{0} דולגו כי הם כבר קיימים כלקוחות.', result.duplicates)}
            </p>
          )}
          {result.invalid.length > 0 && (
            <p className="text-sm text-ink-muted">
              {tr('{0} שורות לא יובאו בגלל פרטים חסרים או שגויים:', result.invalid.length)}
            </p>
          )}
        </div>
      </div>
      {shown.length > 0 && (
        <ul className="flex flex-col gap-1 rounded-xl bg-surface-muted p-3 text-sm">
          {shown.map((i) => (
            <li key={i.row}>
              <span className="font-medium text-ink">
                {tr('שורה {0}', lines[i.row - 1] ?? i.row + 1)}
              </span>
              {': '}
              <span className="text-ink-muted">{tr(i.reason)}</span>
            </li>
          ))}
          {result.invalid.length > shown.length && (
            <li className="text-ink-muted">
              {tr('ועוד {0}…', result.invalid.length - shown.length)}
            </li>
          )}
        </ul>
      )}
      <div className="flex justify-end">
        <Button onClick={onClose}>{tr('סיום')}</Button>
      </div>
    </div>
  );
}
