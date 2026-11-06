import { normalizePhone, PHONE_COUNTRIES, splitPhone, type PhoneCountry } from '@leadflow/shared';
import { ChevronDown } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { cn } from '../../lib/cn';
import { intlLocale, tr } from '../../i18n';
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
 * empty stays empty. Labeled, keyboard reachable; the picker is a native select.
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
  const dial = PHONE_COUNTRIES.find((c) => c.iso === country)!.dial;
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
      <div dir="ltr" className="flex">
        <div
          className={cn(
            'relative flex shrink-0 items-center gap-1.5 rounded-s-lg border border-e-0 bg-surface-muted ps-3 pe-2 text-sm text-ink focus-within:ring-4 focus-within:ring-brand-500/15',
            error ? 'border-danger-600' : 'border-surface-border',
          )}
        >
          <span aria-hidden className="text-base leading-none">
            {flagOf(country)}
          </span>
          <span aria-hidden className="tabular-nums">
            +{dial}
          </span>
          <ChevronDown aria-hidden className="h-3.5 w-3.5 text-ink-subtle" />
          <select
            aria-label={tr('קידומת מדינה')}
            value={country}
            onChange={(e) => {
              emit(e.target.value as PhoneCountry, national);
            }}
            onBlur={onBlur}
            className="absolute inset-0 cursor-pointer opacity-0"
          >
            {names.map((c) => (
              <option key={c.iso} value={c.iso}>
                {`${flagOf(c.iso)} ${c.name} (+${c.dial})`}
              </option>
            ))}
          </select>
        </div>
        <input
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
