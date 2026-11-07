import { CircleHelp } from 'lucide-react';
import { useId, useState } from 'react';
import { tr } from '../../i18n';

/**
 * A small "?" that explains a box (D-128). Shown on hover, on keyboard focus and on tap; Escape or
 * moving away hides it. It sits above the box's stretched link, so pressing it never navigates.
 */
export function HelpTip({ label, text }: { label: string; text: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <span
      className="relative z-10 inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label={tr('מה זה {0}?', label)}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        // A tap focuses and clicks at once; opening (not toggling) keeps it open on phones.
        onClick={() => setOpen(true)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false);
        }}
        className="flex h-5 w-5 items-center justify-center rounded-full text-ink-subtle hover:text-brand-600 focus-visible:text-brand-600"
      >
        <CircleHelp aria-hidden className="h-4 w-4" />
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          className="absolute start-1/2 top-full z-20 mt-2 w-60 -translate-x-1/2 rounded-lg bg-ink px-3 py-2 text-xs font-normal leading-relaxed text-white shadow-lift rtl:translate-x-1/2"
        >
          {text}
        </span>
      )}
    </span>
  );
}
