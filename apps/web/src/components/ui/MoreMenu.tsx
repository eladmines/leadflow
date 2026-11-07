import { MoreHorizontal } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { tr } from '../../i18n';
import { buttonClasses } from './Button';

/**
 * "More" (D-138): a page's secondary actions in a small panel, so each page shows one main button.
 * Closes on Escape or a click outside.
 */
export function MoreMenu({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className={buttonClasses('secondary', 'md')}
      >
        <MoreHorizontal aria-hidden className="h-4 w-4" />
        {tr('עוד')}
      </button>
      {open && (
        <div
          id={id}
          className="absolute end-0 top-full z-20 mt-2 flex w-52 flex-col gap-2 rounded-xl border border-surface-border bg-surface p-2 shadow-lift [&>*]:w-full [&>*]:justify-start"
        >
          {children}
        </div>
      )}
    </div>
  );
}
