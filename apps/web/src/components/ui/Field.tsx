import { forwardRef, useId, type InputHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

export interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string;
  /** Force left-to-right input (emails, phone numbers, URLs) inside the RTL layout. */
  ltr?: boolean;
}

/** Labeled text input with hint and inline error, wired for screen readers. */
export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { label, hint, error, ltr, className, id, required, ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-sm font-medium text-ink">
        {label}
        {required && (
          <span aria-hidden className="ms-0.5 text-danger-600">
            *
          </span>
        )}
      </label>
      <input
        ref={ref}
        id={inputId}
        required={required}
        dir={ltr ? 'ltr' : undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={[hintId, errorId].filter(Boolean).join(' ') || undefined}
        className={cn(
          'h-10 rounded-lg border bg-surface px-3 text-sm text-ink placeholder:text-ink-subtle',
          ltr && 'text-end',
          error ? 'border-danger-600' : 'border-surface-border focus-visible:border-brand-500',
          className,
        )}
        {...rest}
      />
      {hint && !error && (
        <p id={hintId} className="text-xs text-ink-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-xs text-danger-600">
          {error}
        </p>
      )}
    </div>
  );
});
