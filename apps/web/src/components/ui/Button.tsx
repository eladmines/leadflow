import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';
import { Spinner } from './Spinner';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const variants: Record<Variant, string> = {
  primary:
    'bg-brand-600 text-white shadow-sm shadow-ink/10 hover:bg-brand-700 active:bg-brand-800 disabled:bg-brand-300 disabled:shadow-none',
  secondary:
    'bg-surface text-ink border border-surface-border shadow-card hover:bg-surface-muted hover:border-accent-300 disabled:text-ink-subtle',
  ghost:
    'bg-transparent text-ink-muted hover:bg-surface-sunken hover:text-ink disabled:text-ink-subtle',
  danger: 'bg-danger-600 text-white hover:bg-danger-700 disabled:opacity-60',
};

const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px]',
  md: 'h-9 px-3.5 text-sm',
  lg: 'h-11 px-5 text-[15px]',
};

/** Button look for elements that aren't buttons (e.g. a router Link that acts as a CTA). */
export function buttonClasses(variant: Variant = 'primary', size: Size = 'md', className?: string) {
  return cn(
    'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:cursor-not-allowed',
    variants[variant],
    sizes[size],
    className,
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, disabled, className, children, type, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClasses(variant, size, className)}
      {...rest}
    >
      {loading && <Spinner size="sm" label="" />}
      {children}
    </button>
  );
});
