import { normalizePhone, PHONE_COUNTRIES, splitPhone, type PhoneCountry } from '@leadflow/shared';
import { Check, ChevronDown, Search } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { cn } from '../../lib/cn';
import { intlLocale, isRtl, tr } from '../../i18n';
import { inputClasses } from './Field';

/** 🇮🇱 from "IL" (regional indicator letters; some systems show the two letters instead). */
const flagOf = (iso: string) =>
  String.fromCodePoint(...[...iso].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));

/**
 * A first guess at the person's country: Israel when the device is on Israel's time zone (many
 * Israelis browse in en-US), else the browser's region when it's in the list (en-GB → GB),
 * else Israel.
 */
export function browserCountry(): PhoneCountry {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (zone === 'Asia/Jerusalem' || zone === 'Asia/Tel_Aviv') return 'IL';
  const region = navigator.language.split('-')[1]?.toUpperCase();
  return PHONE_COUNTRIES.find((c) => c.iso === region)?.iso ?? 'IL';
}

/**
 * A saved value → country and the number to show: its own country (Israeli numbers in local
 * form), Israel for a local number without a code, else the default with an empty number.
 */
function parseValue(value: string, fallback: PhoneCountry) {
  if (value.startsWith('+')) {
    const split = splitPhone(normalizePhone(value) ?? value);
    if (split.country) return { country: split.country, national: split.national };
  }
  return { country: value ? ('IL' as const) : fallback, national: value };
}

/**
 * Phone input with a country-code picker (D-121). The form value is the full number with its
 * code (`+44 7700 900123`, `+972 050-1234567`), which the shared schema normalises to E.164;
 * empty stays empty. Labeled, keyboard reachable; the picker opens under the field with a
 * search box and a short scrolling list.
 */
export function PhoneField({
  label,
  value,
  onChange,
  onBlur,
  error,
  hint,
  required,
  defaultCountry = 'IL',
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  error?: string;
  hint?: string;
  required?: boolean;
  /** Used when the value is empty (the business's or the browser's country). */
  defaultCountry?: PhoneCountry;
  placeholder?: string;
}) {
  const id = useId();
  // What the person types stays as typed; the saved value is read only when it changes from
  // outside (the form loads or resets), never reformatted under their fingers.
  const [state, setState] = useState(() => parseValue(value, defaultCountry));
  const emitted = useRef(value);
  useEffect(() => {
    if (value !== emitted.current) {
      emitted.current = value;
      setState(parseValue(value, defaultCountry));
    }
  }, [value, defaultCountry]);
  const { country, national } = state;
  const numberRef = useRef<HTMLInputElement>(null);
  const emit = (picked: PhoneCountry, nextNational: string) => {
    const typed = nextNational.trim();
    // A full number typed or pasted with its code (+44 …, 0044 …) speaks for itself; the picker
    // follows it once it's complete.
    const full = typed.startsWith('+') || typed.startsWith('00');
    const detected = full ? splitPhone(normalizePhone(typed)).country : null;
    const nextCountry = detected ?? picked;
    const code = PHONE_COUNTRIES.find((c) => c.iso === nextCountry)!.dial;
    const next = !typed ? '' : full ? typed : `+${code} ${nextNational}`;
    setState({ country: nextCountry, national: nextNational });
    emitted.current = next;
    onChange(next);
  };

  const names = useMemo(() => {
    const display = new Intl.DisplayNames([intlLocale()], { type: 'region' });
    return [...PHONE_COUNTRIES]
      .map((c) => ({ ...c, name: display.of(c.iso) ?? c.iso }))
      .sort((a, b) => a.name.localeCompare(b.name, intlLocale()));
  }, []);

  const hintId = hint && !error ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={`${id}-number`} className="text-sm font-medium text-ink">
        {label}
        {required && (
          <span aria-hidden className="ms-0.5 text-danger-600">
            *
          </span>
        )}
      </label>
      {/* Code then number, left to right in both languages. */}
      <div dir="ltr" className="relative flex">
        <CountryPicker
          country={country}
          countries={names}
          invalid={Boolean(error)}
          onPick={(next) => {
            emit(next, national);
            numberRef.current?.focus();
          }}
        />
        <input
          ref={numberRef}
          id={`${id}-number`}
          dir="ltr"
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          required={required}
          value={national}
          placeholder={placeholder ?? (country === 'IL' ? '050-1234567' : '')}
          onChange={(e) => emit(country, e.target.value)}
          onBlur={onBlur}
          aria-invalid={error ? true : undefined}
          aria-describedby={[hintId, errorId].filter(Boolean).join(' ') || undefined}
          className={cn(inputClasses(Boolean(error)), 'rounded-s-none')}
        />
      </div>
      {hintId && (
        <p id={hintId} className="text-xs text-ink-muted">
          {hint}
        </p>
      )}
      {errorId && (
        <p id={errorId} className="text-xs text-danger-600">
          {tr(error!)}
        </p>
      )}
    </div>
  );
}

type CountryOption = { iso: PhoneCountry; dial: string; name: string };

/**
 * The code picker: a button showing flag + code that opens a small panel under the field — a
 * search box (name, code or +code) over a scrolling list (D-121). Combobox pattern: arrows move,
 * Enter picks, Escape closes back to the button; a click outside closes it.
 */
function CountryPicker({
  country,
  countries,
  invalid,
  onPick,
}: {
  country: PhoneCountry;
  countries: CountryOption[];
  invalid: boolean;
  onPick: (iso: PhoneCountry) => void;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const current = countries.find((c) => c.iso === country)!;

  const q = query.trim().toLowerCase().replace(/^\+/, '');
  const shown = q
    ? countries.filter(
        (c) =>
          c.name.toLowerCase().includes(q) || c.dial.startsWith(q) || c.iso.toLowerCase() === q,
      )
    : countries;

  const close = (focusButton: boolean) => {
    setOpen(false);
    setQuery('');
    if (focusButton) buttonRef.current?.focus();
  };
  const pick = (c: CountryOption) => {
    setOpen(false);
    setQuery('');
    onPick(c.iso);
  };

  // A click anywhere else closes the panel.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  /** Scrolls the list only (never the page, which would slide the list under the pointer). */
  const reveal = (selector: string, center: boolean) => {
    const list = listRef.current;
    const el = list?.querySelector<HTMLElement>(selector);
    if (!list || !el) return;
    const top = el.offsetTop;
    if (center) list.scrollTop = top - list.clientHeight / 2 + el.offsetHeight / 2;
    else if (top < list.scrollTop) list.scrollTop = top;
    else if (top + el.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = top + el.offsetHeight - list.clientHeight;
    }
  };
  // On opening, the current country sits in the middle of the list.
  useEffect(() => {
    if (open) reveal('[aria-selected="true"]', true);
  }, [open]);
  // Keep the highlighted country in view while moving with the arrows.
  useEffect(() => {
    if (open) reveal(`[data-index="${active}"]`, false);
  }, [active, open]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, shown.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (shown[active]) pick(shown[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close(true);
    } else if (e.key === 'Tab') {
      close(false);
    }
  };

  return (
    <div ref={rootRef} className="flex shrink-0">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${tr('קידומת מדינה')}: ${current.name} +${current.dial}`}
        onClick={() => {
          if (open) return close(false);
          setActive(
            Math.max(
              0,
              countries.findIndex((c) => c.iso === country),
            ),
          );
          setOpen(true);
        }}
        className={cn(
          'flex items-center gap-1.5 rounded-s-lg border border-e-0 bg-surface-muted ps-3 pe-2 text-sm text-ink hover:bg-surface-sunken focus-visible:ring-4 focus-visible:ring-brand-500/15 focus-visible:ring-offset-0',
          invalid ? 'border-danger-600' : 'border-surface-border',
        )}
      >
        <span aria-hidden className="text-base leading-none">
          {flagOf(country)}
        </span>
        <span className="tabular-nums">+{current.dial}</span>
        <ChevronDown aria-hidden className="h-3.5 w-3.5 text-ink-subtle" />
      </button>

      {open && (
        // Anchored in the field's left-to-right row (under the code button); the list itself reads
        // in the page's direction.
        <div className="absolute start-0 top-full z-40 mt-1">
          <div
            dir={isRtl() ? 'rtl' : 'ltr'}
            className="w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-surface-border bg-surface shadow-lift"
          >
            <div className="border-b border-surface-border p-2">
              <div className="relative">
                <Search
                  aria-hidden
                  className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle"
                />
                <input
                  autoFocus
                  role="combobox"
                  aria-expanded
                  aria-controls={listId}
                  aria-autocomplete="list"
                  aria-activedescendant={
                    shown[active] ? `${listId}-${shown[active].iso}` : undefined
                  }
                  aria-label={tr('חיפוש מדינה')}
                  placeholder={tr('חיפוש מדינה או קידומת')}
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
            <ul
              ref={listRef}
              id={listId}
              role="listbox"
              aria-label={tr('מדינות')}
              className="relative max-h-60 overflow-y-auto py-1"
            >
              {shown.map((c, i) => (
                <li
                  key={c.iso}
                  id={`${listId}-${c.iso}`}
                  data-index={i}
                  role="option"
                  aria-selected={c.iso === country}
                  // Only a real pointer move highlights (scrolling under a resting pointer doesn't).
                  onMouseMove={() => active !== i && setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(c)}
                  className={cn(
                    'flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm',
                    i === active ? 'bg-brand-50' : '',
                    c.iso === country ? 'font-semibold text-brand-700' : 'text-ink',
                  )}
                >
                  <span aria-hidden className="text-base leading-none">
                    {flagOf(c.iso)}
                  </span>
                  <span className="flex-1 truncate">{c.name}</span>
                  <span dir="ltr" className="tabular-nums text-ink-muted">
                    +{c.dial}
                  </span>
                  {c.iso === country && <Check aria-hidden className="h-4 w-4 text-brand-600" />}
                </li>
              ))}
              {shown.length === 0 && (
                <li className="px-3 py-4 text-center text-sm text-ink-muted">
                  {tr('לא נמצאה מדינה')}
                </li>
              )}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
