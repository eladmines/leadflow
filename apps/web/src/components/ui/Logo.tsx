import { useId } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '../../lib/cn';

/**
 * LeadFlow wordmark (D-115): a bullseye with a dart that has just landed — a lead caught — drawn
 * open, without a tile, in blue with a coral centre. The name is always LTR; in Hebrew the icon
 * sits on the right of it, where reading starts.
 */
export function Logo({
  className,
  compact,
  to,
}: {
  className?: string;
  compact?: boolean;
  /** When set, the logo is a link (e.g. "/" to go home). */
  to?: string;
}) {
  // Unique per instance: a gradient defined inside a hidden copy (e.g. the desktop sidebar on
  // mobile) can't be referenced by a visible one.
  const id = `lf-mark-${useId().replace(/:/g, '')}`;
  const mark = (
    <span
      dir="ltr"
      className={cn('inline-flex items-center gap-2 rtl:flex-row-reverse', className)}
    >
      <svg aria-hidden viewBox="0 0 64 64" className="h-8 w-8 shrink-0">
        <defs>
          <linearGradient id={`${id}b`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#4f8ff7" />
            <stop offset="1" stopColor="#1d4ed8" />
          </linearGradient>
          <linearGradient id={`${id}c`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#ff8a5c" />
            <stop offset="1" stopColor="#f2564a" />
          </linearGradient>
        </defs>
        <circle
          cx="29"
          cy="35"
          r="23"
          fill="none"
          stroke={`url(#${id}b)`}
          strokeOpacity=".35"
          strokeWidth="5"
        />
        <circle cx="29" cy="35" r="13.5" fill="none" stroke={`url(#${id}b)`} strokeWidth="5" />
        <circle cx="29" cy="35" r="6" fill={`url(#${id}c)`} />
        {/* The dart */}
        <path
          d="M30.5 33.5L51 13"
          stroke={`url(#${id}b)`}
          strokeWidth="3.6"
          strokeLinecap="round"
        />
        <path d="M48 6.5l1.8 7.2 7.2 1.8-5.4 5.4-7.2-1.8-1.8-7.2z" fill={`url(#${id}b)`} />
      </svg>
      {!compact && (
        <span className="text-[17px] font-semibold tracking-tight text-ink">
          Lead<span className="text-brand-600">Flow</span>
        </span>
      )}
    </span>
  );
  if (!to) return mark;
  return (
    <Link
      to={to}
      aria-label="LeadFlow"
      className="inline-flex rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
    >
      {mark}
    </Link>
  );
}
