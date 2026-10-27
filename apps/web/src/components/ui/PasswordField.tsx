import { forwardRef, useId, useState, type InputHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';
import { inputClasses } from './Field';

export interface PasswordFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: string;
  hint?: string;
  error?: string;
}

function EyeIcon({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
    >
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
      {!open && <path d="M4 4l16 16" />}
    </svg>
  );
}

/**
 * Password input with an accessible show/hide toggle. The value is always LTR.
 *
 * Layout note: the toggle sits at the inline end of the RTL wrapper (the left edge).
 * The input itself is `dir="ltr"`, so *its* inline start is also the left edge; that is
 * why the room for the toggle is `ps-11` on the input.
 */
export const PasswordField = forwardRef<HTMLInputElement, PasswordFieldProps>(
  function PasswordField({ label, hint, error, id, required, className, ...rest }, ref) {
    const [visible, setVisible] = useState(false);
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
        <div className="relative">
          <input
            ref={ref}
            id={inputId}
            type={visible ? 'text' : 'password'}
            dir="ltr"
            required={required}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-invalid={error ? true : undefined}
            aria-describedby={[hintId, errorId].filter(Boolean).join(' ') || undefined}
            className={cn(inputClasses(Boolean(error)), 'ps-11 text-end', className)}
            {...rest}
          />
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            aria-label={visible ? 'הסתרת הסיסמה' : 'הצגת הסיסמה'}
            aria-pressed={visible}
            aria-controls={inputId}
            className="absolute inset-y-0 end-0 flex w-11 items-center justify-center rounded-lg text-ink-muted hover:text-ink"
          >
            <EyeIcon open={!visible} />
          </button>
        </div>
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
  },
);
