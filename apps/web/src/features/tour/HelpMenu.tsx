import { CircleHelp, Compass, Map, Search } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { cn } from '../../lib/cn';
import { tr } from '../../i18n';
import { shortcutLabel } from '../shell/CommandPalette';

interface Item {
  label: string;
  icon: typeof Compass;
  hint?: string;
  run: () => void;
}

/**
 * Floating help button (D-104) in the bottom corner on the end side (right in English, left in
 * Hebrew): this page's tour, the product tour and quick search in one place. A menu button with
 * arrow-key navigation; Escape or a click outside closes it and returns focus to the button.
 */
export function HelpMenu({
  onPageTour,
  onProductTour,
  onSearch,
}: {
  /** Null on screens without a page tour. */
  onPageTour: (() => void) | null;
  onProductTour: () => void;
  onSearch: () => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();

  const list: Item[] = [
    ...(onPageTour ? [{ label: tr('סיור בעמוד'), icon: Compass, run: onPageTour }] : []),
    { label: tr('סיור במערכת'), icon: Map, run: onProductTour },
    { label: tr('חיפוש מהיר'), icon: Search, hint: shortcutLabel, run: onSearch },
  ];

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    items.current[0]?.focus();
    const outside = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, [open]);

  const onMenuKey = (e: KeyboardEvent) => {
    const current = items.current.indexOf(document.activeElement as HTMLButtonElement);
    const move = (to: number) => {
      e.preventDefault();
      items.current[(to + list.length) % list.length]?.focus();
    };
    if (e.key === 'ArrowDown') move(current + 1);
    else if (e.key === 'ArrowUp') move(current - 1);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(list.length - 1);
    else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Tab') setOpen(false);
  };

  return (
    <div ref={root} className="fixed bottom-4 end-4 z-30 print:hidden">
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={tr('עזרה')}
          onKeyDown={onMenuKey}
          className="absolute bottom-full end-0 mb-2 flex w-60 flex-col rounded-xl border border-surface-border bg-surface p-1.5 shadow-lift"
        >
          {list.map((item, i) => (
            <button
              key={item.label}
              ref={(el) => {
                items.current[i] = el;
              }}
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={() => {
                close(false);
                item.run();
              }}
              className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-start text-sm text-ink hover:bg-surface-sunken focus:bg-surface-sunken focus:outline-none"
            >
              <item.icon aria-hidden className="h-4 w-4 text-ink-muted" />
              <span className="flex-1">{item.label}</span>
              {item.hint && (
                <kbd dir="ltr" className="text-xs text-ink-subtle">
                  {item.hint}
                </kbd>
              )}
            </button>
          ))}
        </div>
      )}
      <button
        ref={trigger}
        type="button"
        aria-label={tr('עזרה')}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={cn(
          'flex h-10 w-10 items-center justify-center rounded-full border border-surface-border bg-surface text-ink-muted shadow-lift transition-colors hover:text-ink',
          open && 'text-ink',
        )}
      >
        <CircleHelp aria-hidden className="h-5 w-5" />
      </button>
    </div>
  );
}
