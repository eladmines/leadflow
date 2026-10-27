import { Lock } from 'lucide-react';

export function NoPermission({ what }: { what: string }) {
  return (
    <section className="flex flex-col items-center gap-3 rounded-xl border border-surface-border bg-surface px-6 py-14 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-muted text-ink-muted">
        <Lock aria-hidden className="h-6 w-6" />
      </span>
      <h2 className="text-lg font-semibold text-ink">אין לך הרשאה לצפות ב{what}</h2>
      <p className="max-w-md text-sm text-ink-muted">אם צריך גישה, פנו לבעל/ת העסק.</p>
    </section>
  );
}
