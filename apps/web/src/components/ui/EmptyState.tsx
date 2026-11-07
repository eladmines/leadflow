import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

interface EmptyStateProps {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  /** A friendly icon on a coloured tile (D-139), usually the section's own. */
  icon?: LucideIcon;
  /** Tile colour classes, e.g. `bg-amber-500`. */
  tone?: string;
  /** Inside a panel: no frame of its own. */
  bare?: boolean;
}

export function EmptyState({
  title,
  description,
  action,
  icon: Icon,
  tone = 'bg-brand-600',
  bare = false,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 px-6 py-12 text-center',
        !bare && 'rounded-xl border border-dashed border-surface-border bg-surface',
      )}
    >
      {Icon && (
        <span
          aria-hidden
          className={cn(
            'flex h-14 w-14 items-center justify-center rounded-2xl text-white shadow-sm',
            tone,
          )}
        >
          <Icon className="h-7 w-7" />
        </span>
      )}
      <h2 className="text-lg font-semibold text-ink">{title}</h2>
      {description && <p className="max-w-md text-sm text-ink-muted">{description}</p>}
      {action}
    </div>
  );
}
