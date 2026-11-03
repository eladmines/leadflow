import { Languages } from 'lucide-react';
import { cn } from '../lib/cn';
import { locale, setLocale, type Locale } from '.';

const OPTIONS: { value: Locale; label: string; lang: string }[] = [
  { value: 'en', label: 'English', lang: 'en' },
  { value: 'he', label: 'עברית', lang: 'he' },
];

/**
 * English / עברית (D-100). Each option is labelled in its own language so anyone can find theirs.
 * Switching reloads the page in the new language and direction.
 */
export function LanguageSwitch({ className }: { className?: string }) {
  const current = locale();
  return (
    <div
      role="group"
      aria-label="Language / שפה"
      className={cn('inline-flex items-center gap-1 rounded-lg text-sm', className)}
    >
      <Languages aria-hidden className="h-4 w-4 text-ink-muted" />
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          lang={o.lang}
          aria-pressed={current === o.value}
          onClick={() => current !== o.value && setLocale(o.value)}
          className={cn(
            'rounded-md px-2 py-1',
            current === o.value
              ? 'bg-surface-sunken font-medium text-ink'
              : 'text-ink-muted hover:bg-surface-sunken hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
