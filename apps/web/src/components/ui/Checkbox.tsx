import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../../lib/cn';

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** May contain links; clicking a link does not toggle the box. */
  label: ReactNode;
  error?: string;
}

/** Checkbox with a clickable label and an inline error wired for screen readers. */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, error, id, className, ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const errorId = error ? `${inputId}-error` : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-start gap-3">
        <input
          ref={ref}
          id={inputId}
          type="checkbox"
          aria-invalid={error ? true : undefined}
          aria-describedby={errorId}
          className={cn(
            'mt-0.5 h-5 w-5 shrink-0 cursor-pointer rounded border-surface-border accent-brand-600',
            error && 'outline outline-1 outline-danger-600',
            className,
          )}
          {...rest}
        />
        <label htmlFor={inputId} className="cursor-pointer text-sm leading-6 text-ink">
          {label}
        </label>
      </div>
      {error && (
        <p id={errorId} className="text-xs text-danger-600">
          {error}
        </p>
      )}
    </div>
  );
});
