import { Construction } from 'lucide-react';
import type { NavItem } from './nav';
import { PageHeader } from './PageHeader';

/** Placeholder for sections that aren't built yet. Describes what's coming; never shows fake data. */
export function ComingSoonPage({ item }: { item: NavItem }) {
  return (
    <>
      <PageHeader title={item.label} />
      <section className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-surface-border bg-surface px-6 py-14 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-700">
          <Construction aria-hidden className="h-6 w-6" />
        </span>
        <h2 className="text-lg font-semibold text-ink">{item.comingSoon?.title}</h2>
        <p className="max-w-md text-sm text-ink-muted">{item.comingSoon?.description}</p>
        <p className="text-xs text-ink-subtle">החלק הזה נמצא בפיתוח ויתווסף בקרוב.</p>
      </section>
    </>
  );
}
