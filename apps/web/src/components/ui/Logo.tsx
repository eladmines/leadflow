import { Link } from 'react-router-dom';
import { cn } from '../../lib/cn';
import logoUrl from '../../assets/brand/logo.svg';
import markUrl from '../../assets/brand/icon-c.svg';

/**
 * simpleCatch wordmark (D-182): "simple" and "atch" in navy and a larger blue C, drawn as outlines
 * so it looks the same everywhere. The name is always LTR, in Hebrew too. `compact` shows only the
 * C. The files come from docs/brand/.
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
  const mark = (
    <img
      src={compact ? markUrl : logoUrl}
      // The link below carries the name; a bare logo describes itself.
      alt={to ? '' : 'SimpleCatch'}
      draggable={false}
      className={cn('h-7 w-auto select-none', compact && 'h-8', className)}
    />
  );
  if (!to) return mark;
  return (
    <Link
      to={to}
      aria-label="SimpleCatch"
      className="inline-flex rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
    >
      {mark}
    </Link>
  );
}
