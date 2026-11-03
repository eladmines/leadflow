import { Compass, Map, Search, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { cn } from '../../lib/cn';
import { tr } from '../../i18n';
import { shortcutLabel } from '../shell/CommandPalette';
import { HelpCharacter } from './HelpCharacter';

/** Closed with X: not again in this visit (tab). "Don't show again": never in this browser. */
const SAID_HELLO = 'leadflow.helper.hello';
const QUIET = 'leadflow.helper.quiet';

function shouldSayHello(): boolean {
  try {
    return localStorage.getItem(QUIET) !== '1' && sessionStorage.getItem(SAID_HELLO) !== '1';
  } catch {
    return false;
  }
}
function remember(forever: boolean) {
  try {
    sessionStorage.setItem(SAID_HELLO, '1');
    if (forever) localStorage.setItem(QUIET, '1');
  } catch {
    // Storage blocked: the bubble may show again next visit.
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
 * animated help character (D-105), which greets the person by name once per visit and waves on
 * hover or focus. Opening it
 * shows the helper introducing himself, with the options under that. A menu button with
 * arrow-key navigation; Escape or a click outside closes it and returns focus to the button.
 */
export function HelpMenu({
  name,
  busy,
  onPageTour,
  onProductTour,
  onSearch,
}: {
  /** The signed-in person's first name, for the hello. */
  name?: string;
  /** A tour is running: no hello on top of it. */
  busy?: boolean;
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

  // Once per visit, a hello pops up by itself after the page settles, until closed or clicked.
  useEffect(() => {
    if (busy || !shouldSayHello()) return;
    const show = setTimeout(() => setHello(true), 1500);
    return () => clearTimeout(show);
  }, [busy]);
  const dismiss = (forever = false) => {
    setHello(false);
    remember(forever);
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
      {hello && !open && !busy && (
        <div
          role="status"
          className="absolute bottom-full end-0 mb-3 w-72 rounded-2xl rounded-ee-sm border border-surface-border bg-surface p-3.5 pe-9 text-sm text-ink shadow-lift motion-safe:animate-helper-pop"
        >
          <p className="font-semibold">{name ? tr('היי {0}! 👋', name) : tr('היי! 👋')}</p>
          <p className="mt-0.5 text-ink-muted">
            {tr(
              'אני העוזר של LeadFlow, ואני כאן כדי לעזור לך. לחצו עליי לסיור בעמוד, לסיור במערכת או לחיפוש מהיר.',
            )}
          </p>
          <button
            type="button"
            onClick={() => dismiss(true)}
            className="mt-2 text-xs text-ink-subtle underline hover:text-ink"
          >
            {tr('לא להציג שוב')}
          </button>
          <button
            type="button"
            aria-label={tr('סגירה')}
            onClick={() => dismiss()}
            className="absolute end-2 top-2 flex h-7 w-7 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-sunken hover:text-ink"
          >
            <X aria-hidden className="h-4 w-4" />
          </button>
        </div>
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
          if (hello) dismiss();
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
