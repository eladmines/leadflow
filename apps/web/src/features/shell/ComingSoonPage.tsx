import { Construction } from 'lucide-react';
import type { NavItem } from './nav';
import { PageHeader } from './PageHeader';

/** Placeholder for sections that aren't built yet. Describes what's coming; never shows fake data. */
export function ComingSoonPage({ item }: { item: NavItem }) {
  return (
    <>
      <PageHeader title={item.label} />
      <section className="flex flex-col items-center gap-3 rounded-3xl border border-surface-border bg-surface px-6 py-16 text-center shadow-card">
        <span className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
          <Construction aria-hidden className="h-7 w-7" />
          <span
            aria-hidden
            className="absolute -end-1 -top-1 h-4 w-4 rounded-full bg-accent-400 ring-4 ring-surface"
          />
        </span>
        <h2 className="text-lg font-semibold text-ink">{item.comingSoon?.title}</h2>
        <p className="max-w-md text-sm text-ink-muted">{item.comingSoon?.description}</p>
        <p className="rounded-full bg-accent-50 px-3 py-1 text-xs font-medium text-accent-700">
          בפיתוח — יתווסף בקרוב
        </p>
      </section>
    </>
  );
}
