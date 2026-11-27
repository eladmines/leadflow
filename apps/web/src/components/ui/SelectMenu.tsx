import { Check, ChevronDown, Search } from 'lucide-react';
import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/cn';
import { inputClasses } from './Field';
import { tr } from '../../i18n';

/** The small control (toolbars, filters, rows): like a field, but 32px high and tighter. */
const compactClasses = (hasError: boolean) =>
  cn(
    'h-8 w-full rounded-lg border bg-surface px-2 text-sm text-ink shadow-card transition-[border-color,box-shadow] hover:border-accent-300 focus-visible:ring-4 focus-visible:ring-offset-0',
    hasError
      ? 'border-danger-600 focus-visible:ring-danger-600/15'
      : 'border-surface-border focus-visible:border-brand-500 focus-visible:ring-brand-500/15',
  );

/** Where the open list goes (all in pixels of the window). */
interface Placement {
  up: boolean;
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  maxHeight: number;
}

interface SelectMenuProps {
  label: string;
  options: readonly { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  id?: string;
  name?: string;
  /** Show a search box in the list. Default: on when there are more than 8 options. */
  searchable?: boolean;
  disabled?: boolean;
  /** A small version for toolbars, filters and table rows (the list is as wide as its longest option). */
  compact?: boolean;
  /** The label is only for screen readers (a filter whose meaning is clear from its first option). */
  labelHidden?: boolean;
  /** Classes for the whole control (its width, for example). */
  className?: string;
  /** Classes for the label (a smaller one in a side menu, for example). */
  labelClassName?: string;
}

/**
 * A styled dropdown (instead of the operating system's native menu) that opens right under the
 * field, with search when the list is long. Keyboard: arrows / Home / End move, Enter (or Space
 * without search) picks, Escape closes.
 */
export function SelectMenu({
  label,
  options,
  value,
  onChange,
  onBlur,
  placeholder,
  hint,
  error,
  required,
  id,
  name,
  searchable,
  disabled,
  compact,
  labelHidden,
  className,
  labelClassName,
}: SelectMenuProps) {
  const autoId = useId();
  const buttonId = id ?? autoId;
  const listId = `${buttonId}-list`;
  const hintId = hint ? `${buttonId}-hint` : undefined;
  const errorId = error ? `${buttonId}-error` : undefined;
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [query, setQuery] = useState('');
  // Where the list goes: upwards when the room below is small and there is more above.
  const [place, setPlace] = useState<Placement | null>(null);
  // Outside a pop-up the list floats above everything (a fixed box over the window), so no container
  // with its own overflow (a board column, a card) can clip it. Inside a pop-up it stays in place,
  // under the pop-up's own scrolling and focus handling.
  const [floating, setFloating] = useState(false);
  const floatRef = useRef<HTMLDivElement>(null);
  // True while the highlight is moved by the keyboard (or at opening): then the list follows it.
  const followActive = useRef(true);

  const hasSearch = searchable ?? options.length > 8;
  const q = query.trim().toLocaleLowerCase();
  const shown = q ? options.filter((o) => o.label.toLocaleLowerCase().includes(q)) : options;
  const selected = options.find((o) => o.value === value);

  // Close on a click outside (the floating list is outside the control's own box).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!rootRef.current?.contains(t) && !floatRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // A floating list follows its control when the window or any scroller moves under it.
  useEffect(() => {
    if (!open || !floating) return;
    const follow = () => setPlace(measure());
    window.addEventListener('resize', follow);
    window.addEventListener('scroll', follow, true);
    return () => {
      window.removeEventListener('resize', follow);
      window.removeEventListener('scroll', follow, true);
    };
    // `measure` only reads refs and props that open the list again when they change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, floating]);

  // Keep the highlighted option in view, inside the list only. The page never scrolls for it (that
  // made the menu jump away from the pointer), and the pointer moving over options changes nothing.
  useEffect(() => {
    if (!open || !followActive.current) return;
    const list = listRef.current;
    const item = list?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    if (!list || !item) return;
    if (item.offsetTop < list.scrollTop) list.scrollTop = item.offsetTop;
    else if (item.offsetTop + item.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = item.offsetTop + item.offsetHeight - list.clientHeight;
    }
  }, [open, active]);

  /** The list's place: below the control, or above it when there is little room below and more above. */
  function measure(): Placement | null {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return null;
    // The list's own height (rows of about 40px, with the search box, at most 15rem plus a margin).
    const needed = Math.min(options.length * 40 + 8, 240) + (hasSearch ? 56 : 0) + 8;
    const below = window.innerHeight - rect.bottom;
    const up = below < needed && rect.top > below;
    return {
      up,
      top: rect.bottom + 4,
      bottom: window.innerHeight - rect.top + 4,
      left: rect.left,
      right: window.innerWidth - rect.right,
      width: rect.width,
      maxHeight: Math.max(120, Math.min(up ? rect.top - 12 : below - 12, 300)),
    };
  }

  function openList() {
    if (disabled) return;
    setPlace(measure());
    setFloating(!rootRef.current?.closest('[role="dialog"]'));
    followActive.current = true;
    setQuery('');
    setActive(
      Math.max(
        0,
        options.findIndex((o) => o.value === value),
      ),
    );
    setOpen(true);
  }

  function close(refocus: boolean) {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  }

  function pick(i: number) {
    const o = shown[i];
    if (o) onChange(o.value);
    close(true);
  }

  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault();
        openList();
      }
      return;
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) followActive.current = true;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActive((a) => Math.min(shown.length - 1, a + 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActive((a) => Math.max(0, a - 1));
        break;
      case 'Home':
        if (hasSearch) break; // moves the caret in the search box
        e.preventDefault();
        setActive(0);
        break;
      case 'End':
        if (hasSearch) break;
        e.preventDefault();
        setActive(shown.length - 1);
        break;
      case 'Enter':
        e.preventDefault();
        pick(active);
        break;
      case ' ':
        if (hasSearch) break; // a space inside the search text
        e.preventDefault();
        pick(active);
        break;
      case 'Escape':
        e.preventDefault();
        close(true);
        break;
      case 'Tab':
        setOpen(false);
        break;
      default:
        if (!hasSearch && e.key.length === 1) {
          const next = shown.findIndex((o) =>
            o.label.toLocaleLowerCase().startsWith(e.key.toLocaleLowerCase()),
          );
          if (next >= 0) setActive(next);
        }
    }
  }

  // "Touched" only once focus leaves the whole control, not when it moves to the search box.
  function onRootBlur(e: FocusEvent<HTMLDivElement>) {
    const to = e.relatedTarget as Node | null;
    if (!rootRef.current?.contains(to) && !floatRef.current?.contains(to)) onBlur?.();
  }

  const activeId = open && shown[active] ? `${listId}-${active}` : undefined;

  const rtl = typeof document !== 'undefined' && document.documentElement.dir === 'rtl';
  const up = place?.up ?? false;
  const listBox = (
    <div
      ref={floatRef}
      style={
        floating && place
          ? {
              ...(place.up ? { bottom: place.bottom } : { top: place.top }),
              ...(rtl ? { right: place.right } : { left: place.left }),
              ...(compact ? { minWidth: place.width } : { width: place.width }),
            }
          : undefined
      }
      className={cn(
        'overflow-hidden rounded-xl border border-surface-border bg-surface shadow-lift',
        floating
          ? // Fixed over the window; a compact control's list is as wide as its longest option.
            cn('fixed z-50', compact && 'w-max max-w-[min(20rem,90vw)]')
          : cn(
              'absolute z-40',
              up ? 'bottom-full mb-1' : 'top-full mt-1',
              compact ? 'start-0 w-max min-w-full max-w-[min(20rem,90vw)]' : 'inset-x-0',
            ),
      )}
    >
      {hasSearch && (
        <div className="border-b border-surface-border p-2">
          <div className="relative">
            <Search
              aria-hidden
              className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle"
            />
            <input
              autoFocus
              role="searchbox"
              aria-label={tr('חיפוש')}
              aria-controls={listId}
              aria-activedescendant={activeId}
              placeholder={tr('חיפוש')}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
              className={cn(inputClasses(false), 'h-9 ps-8 shadow-none')}
            />
          </div>
        </div>
      )}
      <ul
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label={label}
        className="scrollbar-visible overflow-y-auto py-1"
        style={{ maxHeight: place?.maxHeight ?? 240 }}
      >
        {shown.map((o, i) => (
          <li
            key={o.value}
            id={`${listId}-${i}`}
            data-index={i}
            role="option"
            aria-selected={o.value === value}
            onMouseMove={() => {
              followActive.current = false;
              if (active !== i) setActive(i);
            }}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => pick(i)}
            className={cn(
              'flex cursor-pointer items-center gap-2 px-3 py-2 text-base sm:text-sm',
              i === active && 'bg-brand-50',
              o.value === value ? 'font-semibold text-brand-700' : 'text-ink',
            )}
          >
            <span className="min-w-0 flex-1 break-words">{o.label}</span>
            {o.value === value && <Check aria-hidden className="h-4 w-4" />}
          </li>
        ))}
        {shown.length === 0 && (
          <li role="presentation" className="px-3 py-3 text-sm text-ink-muted">
            {tr('לא נמצאו תוצאות')}
          </li>
        )}
      </ul>
    </div>
  );

  return (
    <div
      ref={rootRef}
      onBlur={onRootBlur}
      // min-w-0 / max-w-full: a long chosen label is cut short with an ellipsis instead of widening
      // the control (and the page) past its container; the full text stays in the title.
      className={cn('relative flex min-w-0 max-w-full flex-col gap-1.5', className)}
    >
      <label
        htmlFor={buttonId}
        className={cn('text-sm font-medium text-ink', labelClassName, labelHidden && 'sr-only')}
      >
        {label}
        {required && (
          <span aria-hidden className="ms-0.5 text-danger-600">
            *
          </span>
        )}
      </label>
      {/* The list is placed against the button's own box, not the whole control (label and hint). */}
      <div className="relative">
        <button
          ref={buttonRef}
          type="button"
          id={buttonId}
          name={name}
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={!hasSearch ? activeId : undefined}
          aria-required={required}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={[hintId, errorId].filter(Boolean).join(' ') || undefined}
          onClick={() => (open ? setOpen(false) : openList())}
          onKeyDown={onKeyDown}
          className={cn(
            compact ? compactClasses(!!error) : inputClasses(!!error),
            'flex min-w-0 cursor-pointer items-center justify-between gap-2 text-start disabled:cursor-not-allowed disabled:opacity-60',
          )}
        >
          <span
            title={selected?.label}
            className={cn('min-w-0 truncate', !selected && 'text-ink-subtle')}
          >
            {selected?.label ?? placeholder ?? ''}
          </span>
          <ChevronDown
            aria-hidden
            className={cn(
              'h-4 w-4 shrink-0 text-ink-subtle transition-transform',
              open && 'rotate-180',
            )}
          />
        </button>

        {open && (floating ? createPortal(listBox, document.body) : listBox)}
      </div>

      {hint && !error && (
        <p id={hintId} className="text-xs text-ink-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-xs text-danger-600">
          {tr(error)}
        </p>
      )}
    </div>
  );
}
