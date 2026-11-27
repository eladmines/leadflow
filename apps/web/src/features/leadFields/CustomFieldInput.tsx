import type { LeadFieldDefinition } from '@simplecatch/shared';
import { useId } from 'react';
import { Checkbox, SelectMenu } from '../../components/ui';
import { inputClasses } from '../../components/ui/Field';
import { cn } from '../../lib/cn';
import { isRtl, tr } from '../../i18n';
import { rangeText, type RawValue } from './format';

/**
 * One custom lead field as a form control, by its type (F34). The label is the business's own
 * text: shown as written (never through `tr()`), isolated with `<bdi>` / `dir="auto"`.
 */
export function CustomFieldInput({
  field,
  value,
  onChange,
  onBlur,
  error,
  disabled,
  id,
}: {
  field: LeadFieldDefinition;
  value: RawValue;
  onChange: (value: RawValue) => void;
  onBlur?: () => void;
  error?: string;
  disabled?: boolean;
  id?: string;
}) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const errorId = error ? `${inputId}-error` : undefined;
  const hintId = `${inputId}-hint`;

  if (field.type === 'boolean') {
    return (
      <Checkbox
        id={inputId}
        label={<bdi className="[overflow-wrap:anywhere]">{field.label}</bdi>}
        checked={value === true}
        disabled={disabled}
        error={error}
        onChange={(e) => onChange(e.target.checked)}
        onBlur={onBlur}
      />
    );
  }

  if (field.type === 'select') {
    const current = typeof value === 'string' ? value : '';
    const removed = field.options.find((o) => o.id === current && o.archivedAt);
    return (
      <SelectMenu
        id={inputId}
        label={field.label}
        required={field.required}
        disabled={disabled}
        value={current}
        onChange={onChange}
        onBlur={onBlur}
        error={error}
        options={[
          { value: '', label: tr('לא נבחר') },
          ...field.options
            .filter((o) => !o.archivedAt)
            .map((o) => ({ value: o.id, label: o.label })),
          // A value whose option was removed still shows (and stays) until something else is chosen.
          ...(removed ? [{ value: removed.id, label: `${removed.label} (${tr('הוסרה')})` }] : []),
        ]}
      />
    );
  }

  const range = rangeText(field);

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={inputId} className="text-sm font-medium text-ink [overflow-wrap:anywhere]">
        <bdi>{field.label}</bdi>
        {field.required && (
          <span aria-hidden className="ms-0.5 text-danger-600">
            *
          </span>
        )}
      </label>
      <input
        id={inputId}
        type={field.type === 'date' ? 'date' : 'text'}
        inputMode={field.type === 'number' ? 'decimal' : undefined}
        dir={field.type === 'text' ? 'auto' : 'ltr'}
        required={field.required}
        aria-required={field.required || undefined}
        disabled={disabled}
        value={typeof value === 'string' ? value : ''}
        maxLength={field.type === 'text' ? 500 : undefined}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        onKeyDown={(e) => {
          // With an `onBlur` handler, Enter commits the field by leaving it; without one (the lead
          // page's Details, saved with one button, D-207) Enter submits the form as usual.
          if (e.key === 'Enter' && onBlur && field.type !== 'date') e.currentTarget.blur();
        }}
        aria-invalid={error ? true : undefined}
        aria-describedby={[range ? hintId : null, errorId].filter(Boolean).join(' ') || undefined}
        // Numbers and dates are LTR but line up with the page, like phones in `Field`.
        className={cn(inputClasses(Boolean(error)), field.type !== 'text' && isRtl() && 'text-end')}
      />
      {range && !error && (
        <p id={hintId} className="text-xs text-ink-muted">
          {range}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-xs text-danger-600">
          {tr(error)}
        </p>
      )}
    </div>
  );
}
