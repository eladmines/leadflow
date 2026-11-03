import { Compass, Map, Search } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { cn } from '../../lib/cn';
import { tr } from '../../i18n';
import { shortcutLabel } from '../shell/CommandPalette';
import { HelpCharacter } from './HelpCharacter';

const GREETED = 'leadflow.helper.greeted';

/** The hello bubble shows once per browser (a per-viewer convenience). */
function greetedBefore(): boolean {
  try {
    return localStorage.getItem(GREETED) === '1';
  } catch {
    return true;
  }
}
function markGreeted() {
  try {
    localStorage.setItem(GREETED, '1');
  } catch {
    // Private mode: the bubble may show again next time.
  }
}

interface Item {
  label: string;
  icon: typeof Compass;
  hint?: string;
  run: () => void;
}

/**
 * Floating help button (D-104) in the bottom corner on the end side (right in English, left in
 * Hebrew): this page's tour, the product tour and quick search in one place. The button is the
 * animated help character (D-105), which says hello once and waves on hover or focus. Opening it
 * shows the helper introducing himself, with the options under that. A menu button with
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
  const [hover, setHover] = useState(false);
  const [hello, setHello] = useState(false);
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

  // First visit in this browser: a short hello after the page settles.
  useEffect(() => {
    if (greetedBefore()) return;
    const show = setTimeout(() => setHello(true), 1500);
    const hide = setTimeout(() => {
      setHello(false);
      markGreeted();
    }, 8500);
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
    };
  }, []);

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
      {hello && !open && (
        <p
          role="status"
          className="absolute bottom-full end-0 mb-2 w-56 rounded-2xl rounded-ee-sm border border-surface-border bg-surface px-3.5 py-2.5 text-sm text-ink shadow-lift motion-safe:animate-helper-pop"
        >
          {tr('היי! אני העוזר של LeadFlow 👋 לחצו עליי לסיור בעמוד, לסיור במערכת או לחיפוש מהיר.')}
        </p>
      )}
      {open && (
        <div className="absolute bottom-full end-0 mb-2 flex w-64 flex-col rounded-2xl border border-surface-border bg-surface p-1.5 shadow-lift motion-safe:animate-helper-pop">
          {/* The helper introduces himself; the options follow. */}
          <div className="flex items-center gap-2.5 px-2.5 pb-2.5 pt-2">
            <HelpCharacter happy className="h-9 w-9 shrink-0" />
            <div className="flex flex-col">
              <p id={`${menuId}-title`} className="text-sm font-semibold text-ink">
                {tr('היי, אני העוזר של LeadFlow')}
              </p>
              <p className="text-xs text-ink-muted">{tr('במה אפשר לעזור?')}</p>
            </div>
          </div>
          <div
            id={menuId}
            role="menu"
            aria-labelledby={`${menuId}-title`}
            onKeyDown={onMenuKey}
            className="flex flex-col border-t border-surface-border pt-1.5"
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
        </div>
      )}
      <button
        ref={trigger}
        type="button"
        aria-label={tr('עזרה')}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => {
          if (hello) {
            setHello(false);
            markGreeted();
          }
          setOpen((o) => !o);
        }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onFocus={() => setHover(true)}
        onBlur={() => setHover(false)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={cn(
          'flex h-14 w-14 items-center justify-center rounded-full border border-surface-border bg-surface shadow-lift transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-500/30 motion-reduce:transition-none',
          open && 'scale-105',
        )}
      >
        <HelpCharacter happy={open} waving={hover || hello} className="h-11 w-11" />
      </button>
    </div>
  );
}
