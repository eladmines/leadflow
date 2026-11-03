import { cn } from '../../lib/cn';
import { tr } from '../../i18n';

interface SpinnerProps {
  size?: 'sm' | 'md';
  /** Accessible label; pass "" when a parent already announces the busy state. */
  label?: string;
}

export function Spinner({ size = 'md', label = tr('טוען…') }: SpinnerProps) {
  return (
    <span role={label ? 'status' : undefined} className="inline-flex items-center gap-2">
      <span
        aria-hidden
        className={cn(
          'animate-spin rounded-full border-2 border-current border-t-transparent',
          size === 'sm' ? 'h-4 w-4' : 'h-6 w-6',
        )}
      />
      {label && <span className="sr-only">{label}</span>}
    </span>
  );
}
