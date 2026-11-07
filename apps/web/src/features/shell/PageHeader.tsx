import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { cn } from '../../lib/cn';
import { navItemOf } from './nav';

export function PageHeader({
  title,
  description,
  actions,
  inPanel = false,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  /** The top row of a page panel (D-117): padded, with a divider under it. */
  inPanel?: boolean;
}) {
  // The section's icon in its colour beside the title (D-137), so each page is easy to recognise.
  const item = navItemOf(useLocation().pathname);
  const Icon = item?.icon;
  return (
    <div
      className={cn(
        'flex flex-wrap items-end justify-between gap-4 border-b border-surface-border',
        inPanel ? 'p-4 sm:px-5' : 'pb-5',
      )}
    >
      <div className="flex items-start gap-3">
        {item && Icon && (
          <span
            aria-hidden
            className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white shadow-sm',
              item.color.tile,
            )}
          >
            <Icon className="h-5 w-5" />
          </span>
        )}
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold tracking-tight text-ink sm:text-2xl">{title}</h1>
          {description && <p className="text-sm text-ink-muted">{description}</p>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">{actions}</div>
    </div>
  );
}
