import { useId } from 'react';
import { cn } from '../../lib/cn';

/** LeadFlow wordmark: a rounded mark (a lead flowing in) plus the name (always LTR). */
export function Logo({ className, compact }: { className?: string; compact?: boolean }) {
  // Unique per instance: a gradient defined inside a hidden copy (e.g. the desktop sidebar on
  // mobile) can't be referenced by a visible one.
  const gradientId = `lf-mark-${useId().replace(/:/g, '')}`;
  return (
    <span dir="ltr" className={cn('inline-flex items-center gap-2.5', className)}>
      <svg aria-hidden viewBox="0 0 40 40" className="h-7 w-7 shrink-0">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#2c837d" />
            <stop offset="1" stopColor="#1b5653" />
          </linearGradient>
        </defs>
        <rect width="40" height="40" rx="10" fill={`url(#${gradientId})`} />
        <path
          d="M9 25c4.5 0 5.5-10 11-10s6.5 10 11 10"
          stroke="#fff"
          strokeWidth="3"
          strokeLinecap="round"
          fill="none"
        />
        <circle cx="30.5" cy="13" r="3.5" fill="#f77f57" />
      </svg>
      {!compact && (
        <span className="text-[17px] font-semibold tracking-tight text-ink">
          Lead<span className="text-brand-600">Flow</span>
        </span>
      )}
    </span>
  );
}
