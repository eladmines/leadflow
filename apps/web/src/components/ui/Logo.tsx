import { cn } from '../../lib/cn';

/** LeadFlow wordmark: a flow mark plus the product name (always LTR). */
export function Logo({ className }: { className?: string }) {
  return (
    <span dir="ltr" className={cn('inline-flex items-center gap-2', className)}>
      <span
        aria-hidden
        className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-white shadow-sm"
      >
        <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
          <path
            d="M4 16c3.5 0 4-8 8-8s4.5 8 8 8"
            stroke="currentColor"
            strokeWidth={2.2}
            strokeLinecap="round"
          />
          <circle cx="20" cy="16" r="1.8" fill="currentColor" />
        </svg>
      </span>
      <span className="text-xl font-bold tracking-tight text-ink">LeadFlow</span>
    </span>
  );
}
