import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

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
  return (
    <div
      className={cn(
        'flex flex-wrap items-end justify-between gap-4 border-b border-surface-border',
        inPanel ? 'p-4 sm:px-5' : 'pb-5',
      )}
    >
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight text-ink sm:text-2xl">{title}</h1>
        {description && <p className="text-sm text-ink-muted">{description}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">{actions}</div>
    </div>
  );
}
