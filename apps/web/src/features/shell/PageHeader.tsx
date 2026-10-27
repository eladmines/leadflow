import type { ReactNode } from 'react';

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-ink sm:text-3xl">{title}</h1>
        {description && <p className="text-sm text-ink-muted">{description}</p>}
      </div>
      {actions}
    </div>
  );
}
