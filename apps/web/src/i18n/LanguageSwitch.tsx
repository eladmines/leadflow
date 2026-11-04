import { useId } from 'react';
import { cn } from '../lib/cn';
import { locale, setLocale, type Locale } from '.';

/** UK flag for English. Clip ids are per instance: the sidebar and the mobile drawer both render one. */
function UkFlag() {
  const id = useId();
  return (
    <svg viewBox="0 0 60 30" aria-hidden className="h-full w-full">
      <clipPath id={`${id}s`}>
        <path d="M0,0 v30 h60 v-30 z" />
      </clipPath>
      <clipPath id={`${id}t`}>
        <path d="M30,15 h30 v15 z v15 h-30 z h-30 v-15 z v-15 h30 z" />
      </clipPath>
      <g clipPath={`url(#${id}s)`}>
        <path d="M0,0 v30 h60 v-30 z" fill="#012169" />
        <path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" strokeWidth="6" />
        <path
          d="M0,0 L60,30 M60,0 L0,30"
          clipPath={`url(#${id}t)`}
          stroke="#C8102E"
          strokeWidth="4"
        />
        <path d="M30,0 v30 M0,15 h60" stroke="#fff" strokeWidth="10" />
        <path d="M30,0 v30 M0,15 h60" stroke="#C8102E" strokeWidth="6" />
      </g>
    </svg>
  );
}

function IsraelFlag() {
  return (
    <svg viewBox="0 0 220 160" aria-hidden className="h-full w-full">
      <rect width="220" height="160" fill="#fff" />
      <rect y="15" width="220" height="25" fill="#0038b8" />
      <rect y="120" width="220" height="25" fill="#0038b8" />
      <g fill="none" stroke="#0038b8" strokeWidth="5.5">
        <path d="M110,50 L136,95 L84,95 Z" />
        <path d="M110,110 L136,65 L84,65 Z" />
      </g>
    </svg>
  );
}

// Each option is named in its own language so anyone can find theirs.
const OPTIONS: { value: Locale; label: string; flag: () => JSX.Element }[] = [
  { value: 'en', label: 'English', flag: UkFlag },
  { value: 'he', label: 'עברית', flag: IsraelFlag },
];

/**
 * Language flags (D-100, D-110). Switching reloads the page in the new language and direction.
 */
export function LanguageSwitch({ className }: { className?: string }) {
  const current = locale();
  return (
    <div
      role="group"
      aria-label="Language / שפה"
      className={cn('inline-flex shrink-0 items-center gap-1', className)}
    >
      {OPTIONS.map(({ value, label, flag: Flag }) => {
        const active = current === value;
        return (
          <button
            key={value}
            type="button"
            lang={value}
            aria-label={label}
            title={label}
            aria-pressed={active}
            onClick={() => !active && setLocale(value)}
            className={cn(
              'flex h-8 w-9 items-center justify-center rounded-md transition',
              active
                ? 'bg-surface-sunken ring-1 ring-brand-500'
                : 'opacity-60 grayscale-[40%] hover:bg-surface-sunken hover:opacity-100 hover:grayscale-0',
            )}
          >
            <span className="block h-[15px] w-[22px] overflow-hidden rounded-[2px] shadow-[0_0_0_1px_rgba(0,0,0,0.12)]">
              <Flag />
            </span>
          </button>
        );
      })}
    </div>
  );
}
