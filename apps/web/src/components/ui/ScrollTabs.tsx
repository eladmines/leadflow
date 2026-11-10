import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '../../lib/cn';

/**
 * A row of tabs that scrolls sideways when it doesn't fit. Phones and narrow panels used to cut
 * the last tab off with nothing to show it was there, so: the side that has more tabs fades out,
 * and the selected tab is scrolled into view. Pass `activeKey` (the selected tab) so a change
 * brings it into view.
 */
export function ScrollTabs({
  label,
  activeKey,
  className,
  children,
}: {
  label: string;
  activeKey: string;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // scrollLeft is 0 at the start in either direction (negative going on in right-to-left).
    const moved = Math.abs(el.scrollLeft);
    const more = {
      start: moved > 1,
      end: moved + el.clientWidth < el.scrollWidth - 1,
    };
    const rtl = getComputedStyle(el).direction === 'rtl';
    setFade({ left: rtl ? more.end : more.start, right: rtl ? more.start : more.end });
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const active = el.querySelector<HTMLElement>('[aria-selected="true"]');
    // Only sideways: the page itself must not jump.
    active?.scrollIntoView?.({ inline: 'nearest', block: 'nearest' });
    measure();
  }, [activeKey, measure]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(el);
    return () => observer?.disconnect();
  }, [measure]);

  const edge = '2.25rem';
  const mask =
    fade.left || fade.right
      ? `linear-gradient(to right, ${fade.left ? `transparent, #000 ${edge}` : '#000, #000'}, ${
          fade.right ? `#000 calc(100% - ${edge}), transparent` : '#000, #000'
        })`
      : undefined;

  return (
    <div
      ref={ref}
      role="tablist"
      aria-label={label}
      onScroll={measure}
      style={mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined}
      className={cn('flex gap-1 overflow-x-auto', className)}
    >
      {children}
    </div>
  );
}
